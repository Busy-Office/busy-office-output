/**
 * HTTP transport over `OutputPort` (ROADMAP Stage 3 task 1 "Event API",
 * reshaped by GAP-07): three routes, each a THIN adapter over one port
 * verb — parse the wire shape, call the verb, map its typed result to the
 * HTTP status + RFC 9457 problem+json / JSON body this API has always
 * returned. No determination, validation, minting, or rendering happens
 * in this file; `embed/create-output.ts` owns all of it.
 *
 *   POST /event      → port.emit      (optional CloudEvents 1.0 envelope, ADR-006)
 *   POST /render     → port.preview   (HLD §4: no archive, no delivery, no registry)
 *   GET  /documents  → port.status    (?businessObject=&businessObjectId=&event=&templateVersion=)
 *   GET  /output/*   → read-only console (console.ts), straight on the registry
 *
 * Built on Node's built-in `http` module rather than a framework: three
 * routes do not earn a routing/middleware layer, and CLAUDE.md's
 * single-process mandate ("API + worker + embedded queue + FS archive in
 * one command") favors keeping the dependency surface minimal.
 *
 * `createIngressServer()` builds its port from what it is given: an
 * explicit `output`, else `registryStore` + `composition` (what `serve()`
 * and the e2e tests pass — the composition's `documentTypes` registry
 * carries whatever was registered), else a bare, determination-only port
 * over a fresh `:memory:` registry. That bare default knows NO document
 * type — this file never imports one (engine boundary, GAP-08); the
 * composition root's `createIngressServer` wrapper (index.ts) is what
 * registers the built-ins for callers that want them.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { BusinessEventKey } from '@busy-office/output-schema';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import type { RegistryStore } from './registry/registry-store.js';
import type { CallerDeterminationContext } from './determination/index.js';
import type { CompositionDeps } from './composition.js';
import { createOutput, type EmitResult, type OutputPort } from './embed/create-output.js';
import type { DocumentTypeRegistry } from './registration/document-type-registry.js';
import {
  invalidContractProblem,
  malformedCloudEventsProblem,
  malformedRequestProblem,
  methodNotAllowedProblem,
  missingBusinessEventProblem,
  missingTemplateIdProblem,
  noRuleMatchProblem,
  noTemplateMatchProblem,
  notFoundProblem,
  renderFailedProblem,
  unknownDocumentTypeProblem,
  unknownTemplateProblem,
  unresolvedRecipientsProblem,
  unresolvedMessageTemplateProblem,
} from './problem.js';
import { sendJson, sendProblem } from './http-helpers.js';
import { handleConsoleRequest, isConsolePath } from './console.js';
import type { BackoffPolicy, DeliveryQueue } from './delivery/delivery-queue.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MiB — guards against unbounded body reads

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('request body exceeds maximum size');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Parse the JSON body, answering the 400 problem+json itself on failure.
 * Returns `undefined` (after responding) when the caller should stop. */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<{ body: unknown } | undefined> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendProblem(res, malformedRequestProblem('Failed to read request body.'));
    return undefined;
  }
  try {
    return { body: raw.length > 0 ? JSON.parse(raw) : undefined };
  } catch {
    // Never log the raw body (CLAUDE.md: no payloads in logs) — including in errors.
    sendProblem(res, malformedRequestProblem('Request body is not valid JSON.'));
    return undefined;
  }
}

const CLOUDEVENTS_SPECVERSION = '1.0';
/** CloudEvents 1.0 REQUIRED context attributes (excl. specversion itself). */
const CLOUDEVENTS_REQUIRED_ATTRIBUTES = ['id', 'source', 'type'] as const;

/**
 * ADR-006 / docs/STANDARDS.md Tier 2: "CloudEvents 1.0 | optional envelope
 * for POST /event". Detection signal is `specversion: "1.0"` on the parsed
 * body (CloudEvents' own required attribute) — when present, the same
 * ingress payload this route always accepted (documentType/header/lines/
 * totals/businessEvent) is expected in CloudEvents' `data` field, sibling
 * to CloudEvents' own context attributes (id, source, type, ...). When
 * absent, the body is the raw shape exactly as before — this keeps the
 * envelope genuinely optional and reuses the same downstream logic either
 * way (no duplicated path per shape).
 */
function isCloudEventsEnvelope(payload: unknown): payload is Record<string, unknown> {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    (payload as Record<string, unknown>).specversion === CLOUDEVENTS_SPECVERSION
  );
}

/**
 * Unwraps a detected CloudEvents envelope to the inner ingress payload
 * (its `data` field), or returns `raw` unchanged when no envelope is
 * present. Throws only when `specversion: "1.0"` is present but the
 * envelope is otherwise malformed (missing a REQUIRED attribute or `data`)
 * — a 400, not a 500, via the caller's catch.
 */
function unwrapCloudEventsEnvelope(raw: unknown): unknown {
  if (!isCloudEventsEnvelope(raw)) return raw;
  const missing = CLOUDEVENTS_REQUIRED_ATTRIBUTES.filter((attr) => typeof raw[attr] !== 'string' || raw[attr] === '');
  if (missing.length > 0) {
    throw new Error(`CloudEvents envelope is missing required attribute(s): ${missing.join(', ')}.`);
  }
  if (!('data' in raw)) {
    throw new Error('CloudEvents envelope (specversion "1.0") must carry a "data" field.');
  }
  return raw.data;
}

/** Extract documentType without trusting shape — payload may be anything. */
function extractDocumentType(payload: unknown): unknown {
  if (payload !== null && typeof payload === 'object' && 'documentType' in payload) {
    return (payload as Record<string, unknown>).documentType;
  }
  return undefined;
}

/** `payload` minus the named envelope-only sibling fields (they are not
 * part of the data contract, whose schemas are additionalProperties:false). */
function stripEnvelopeFields(payload: unknown, fields: readonly string[]): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  const rest: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const field of fields) delete rest[field];
  return rest;
}

const BUSINESS_EVENT_KEY_FIELDS = ['businessObject', 'businessObjectId', 'event', 'templateVersion'] as const;

/**
 * Validate a candidate BusinessEventKey: all four fields non-empty
 * strings. Shared by `POST /event` (the `businessEvent` body field — the
 * key travels as a top-level object sibling to the contract payload's own
 * fields, not as headers, mirroring how the CloudEvents envelope carries
 * `data` alongside event metadata) and `GET /documents` (query string).
 */
function toBusinessEventKey(record: Record<string, unknown>): BusinessEventKey | undefined {
  for (const field of BUSINESS_EVENT_KEY_FIELDS) {
    if (typeof record[field] !== 'string' || record[field] === '') {
      return undefined;
    }
  }
  return {
    businessObject: record.businessObject as string,
    businessObjectId: record.businessObjectId as string,
    event: record.event as string,
    templateVersion: record.templateVersion as string,
  };
}

function extractBusinessEventKey(payload: unknown): BusinessEventKey | undefined {
  if (payload === null || typeof payload !== 'object' || !('businessEvent' in payload)) {
    return undefined;
  }
  const candidate = (payload as Record<string, unknown>).businessEvent;
  if (candidate === null || typeof candidate !== 'object') {
    return undefined;
  }
  return toBusinessEventKey(candidate as Record<string, unknown>);
}

const DETERMINATION_CONTEXT_FIELDS = ['companyCode', 'country', 'partnerId', 'locale'] as const;

/**
 * Determination's OPTIONAL, caller-supplied routing hints beyond
 * documentType/businessEvent — companyCode/country/partnerId/locale plus
 * `recipients`. None of the data contracts carry these at top level, so a
 * caller who wants finer-than-documentType-and-event rule or
 * template-variant routing supplies them via this sibling envelope field,
 * alongside `businessEvent`. Absent entirely, determination still works —
 * rules/templates that only constrain documentType/event match on
 * wildcards for the rest (docs/VARIANT-RESOLUTION.md semantics).
 */
function extractDeterminationContext(payload: unknown): CallerDeterminationContext {
  if (payload === null || typeof payload !== 'object' || !('determination' in payload)) {
    return {};
  }
  const candidate = (payload as Record<string, unknown>).determination;
  if (candidate === null || typeof candidate !== 'object') {
    return {};
  }
  const record = candidate as Record<string, unknown>;
  const context: CallerDeterminationContext = {};
  for (const field of DETERMINATION_CONTEXT_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value !== '') {
      context[field] = value;
    }
  }
  // `recipients` (Stage 4 clause 2 arb-chair ruling): caller-supplied
  // master data, shape-validated only — an array of non-empty strings —
  // nothing more (no address parsing, no directory lookup: HLD §1 keeps
  // master data outside the boundary). Anything else is treated as absent
  // and determination decides loudly (`unresolved-recipients`).
  const recipients = record.recipients;
  if (Array.isArray(recipients) && recipients.length > 0 && recipients.every((r) => typeof r === 'string' && r !== '')) {
    context.recipients = recipients as string[];
  }
  return context;
}

/** The one HTTP-side mapping of `EmitResult`'s failure members to
 * problem+json. `undefined` means "accepted" — the caller sends the body. */
function emitFailureProblem(result: EmitResult) {
  switch (result.status) {
    case 'unknown-document-type':
      return unknownDocumentTypeProblem(result.documentType);
    case 'invalid-contract':
      return invalidContractProblem(result.documentType, result.errors);
    // Determination (HLD §2/§9, ADR-003): no rule/template match is a loud
    // 422 problem+json carrying the TRACE — never a silent 2xx.
    case 'no-rule-match':
      return noRuleMatchProblem(result.trace);
    case 'no-template-match':
      return noTemplateMatchProblem(result.trace);
    case 'unresolved-recipients':
      return unresolvedRecipientsProblem(result.trace);
    case 'unresolved-message-template':
      return unresolvedMessageTemplateProblem(result.trace);
    case 'accepted':
      return undefined;
  }
}

async function handleEvent(req: IncomingMessage, res: ServerResponse, port: OutputPort, documentTypes: DocumentTypeRegistry | undefined): Promise<void> {
  const parsed = await readJsonBody(req, res);
  if (parsed === undefined) return;

  // ADR-006: optional CloudEvents 1.0 envelope, detected + unwrapped here
  // so the port sees the same shape whether the caller sent raw or wrapped.
  let payload: unknown;
  try {
    payload = unwrapCloudEventsEnvelope(parsed.body);
  } catch (err) {
    sendProblem(res, malformedCloudEventsProblem(err instanceof Error ? err.message : 'Malformed CloudEvents envelope.'));
    return;
  }

  // `businessEvent` and `determination` are envelope metadata, not part of
  // the data-contract payload — the port validates the contract against
  // the payload with those fields stripped.
  const documentPayload = stripEnvelopeFields(payload, ['businessEvent', 'determination']);
  const documentType = extractDocumentType(documentPayload);

  const businessEventKey = extractBusinessEventKey(payload);
  if (businessEventKey === undefined) {
    // Error ORDER is part of this API's contract: an unknown documentType
    // or an invalid contract is reported before a missing businessEvent
    // (the port's own order, which needs the key to run). With no key to
    // hand the port, ask the registry the same two questions first.
    if (documentTypes !== undefined) {
      if (!documentTypes.has(documentType)) {
        sendProblem(res, unknownDocumentTypeProblem(documentType));
        return;
      }
      const validation = documentTypes.validate(documentType, documentPayload);
      if (!validation.valid) {
        sendProblem(res, invalidContractProblem(documentType, validation.errors));
        return;
      }
    }
    sendProblem(
      res,
      missingBusinessEventProblem(
        'Request body must carry a "businessEvent" object with businessObject, businessObjectId, event, and templateVersion (all non-empty strings).',
      ),
    );
    return;
  }

  const result = await port.emit({
    payload: documentPayload,
    documentType,
    businessEvent: businessEventKey,
    determination: extractDeterminationContext(payload),
  });

  const problem = emitFailureProblem(result);
  if (problem !== undefined || result.status !== 'accepted') {
    sendProblem(res, problem ?? malformedRequestProblem('Unexpected emit outcome.'));
    return;
  }

  // Idempotency (HLD §4): a replayed event returns the SAME docId(s). 202
  // if any resolution was newly minted this call; 200 only when every
  // resolution was already seen (a pure replay). Response shape is the
  // one this route has always had: `composition` per resolution is
  // present only when composition actually ran this call — never on a
  // plain replay (`{ outcome: 'replayed' }` is the port's vocabulary, not
  // the HTTP one). Back-compat primary fields (docId/determination) mirror
  // the FIRST resolution; `resolutions` carries the full fan-out set.
  const results = result.resolutions.map((r) => {
    const composed = r.composition !== undefined && r.composition.outcome !== 'replayed' ? r.composition : undefined;
    return {
      docId: r.docId,
      replayed: r.replayed,
      ruleId: r.ruleId,
      templateId: r.templateId,
      templateVersion: r.templateVersion,
      channel: r.channel,
      recipients: r.recipients,
      locale: r.locale,
      ...(r.renderer !== undefined ? { renderer: r.renderer } : {}),
      ...(composed !== undefined ? { composition: composed } : {}),
    };
  });
  const allReplayed = results.every((r) => r.replayed);
  const [primary] = results;
  sendJson(res, allReplayed ? 200 : 202, {
    status: 'accepted',
    documentType: result.documentType,
    docId: primary.docId,
    replayed: primary.replayed,
    determination: {
      ruleId: primary.ruleId,
      templateId: primary.templateId,
      templateVersion: primary.templateVersion,
      channel: primary.channel,
      recipients: primary.recipients,
      locale: primary.locale,
    },
    resolutions: results,
    trace: result.trace,
  });
}

/**
 * `POST /render` → `port.preview` (HLD §4). Body: the data-contract
 * payload with two envelope siblings — `templateId` (required) and
 * `locale` (optional) — stripped before validation exactly like
 * `businessEvent` on `/event`. Success is the rendered bytes themselves
 * (`Content-Type` = the artifact's media type, `X-Renderer: id@version`),
 * not JSON: a preview is something you look at.
 */
async function handleRender(req: IncomingMessage, res: ServerResponse, port: OutputPort): Promise<void> {
  const parsed = await readJsonBody(req, res);
  if (parsed === undefined) return;
  const body = parsed.body;

  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const templateId = record.templateId;
  const locale = record.locale;
  const documentPayload = stripEnvelopeFields(body, ['templateId', 'locale']);
  const documentType = extractDocumentType(documentPayload);

  if (typeof templateId !== 'string' || templateId === '') {
    sendProblem(res, missingTemplateIdProblem());
    return;
  }

  const result = await port.preview({
    payload: documentPayload,
    documentType,
    templateId,
    ...(typeof locale === 'string' && locale !== '' ? { locale } : {}),
  });

  switch (result.status) {
    case 'unknown-document-type':
      sendProblem(res, unknownDocumentTypeProblem(result.documentType));
      return;
    case 'invalid-contract':
      sendProblem(res, invalidContractProblem(result.documentType, result.errors));
      return;
    case 'unknown-template':
      sendProblem(res, unknownTemplateProblem(result.documentType, result.templateId));
      return;
    case 'render-failed':
      sendProblem(res, renderFailedProblem(result.templateId, result.error));
      return;
    case 'rendered':
      res.writeHead(200, {
        'Content-Type': result.mediaType,
        'Content-Length': result.bytes.byteLength,
        'X-Renderer': result.renderer,
        'X-Template-Id': result.templateId,
      });
      res.end(Buffer.from(result.bytes));
      return;
  }
}

/**
 * `GET /documents?businessObject=&businessObjectId=&event=&templateVersion=`
 * → `port.status`. All four key fields are required (it is the
 * idempotency key, HLD §4 — there is no "search" here; that is the
 * console's Registry screen). 200 with `{ businessEvent, documents }`,
 * `documents` empty when the event was never accepted.
 */
async function handleDocuments(res: ServerResponse, query: URLSearchParams, port: OutputPort): Promise<void> {
  const record: Record<string, unknown> = {};
  for (const field of BUSINESS_EVENT_KEY_FIELDS) record[field] = query.get(field) ?? undefined;
  const key = toBusinessEventKey(record);
  if (key === undefined) {
    sendProblem(
      res,
      malformedRequestProblem(
        'Query must carry businessObject, businessObjectId, event, and templateVersion (all non-empty) — the BusinessEventKey four-tuple.',
      ),
    );
    return;
  }
  const documents = await port.status(key);
  sendJson(res, 200, { businessEvent: key, documents });
}

export interface IngressServerOptions {
  /**
   * The port every route adapts. When supplied, `registryStore` /
   * `composition` are only used for the console routes and the
   * missing-businessEvent error-ordering check; the port is otherwise
   * authoritative. When omitted, a port is built from the other options
   * (see the module header).
   */
  output?: OutputPort;
  /**
   * The durable document registry: backs the read-only `/output/*`
   * console routes (console.ts) and, when no `output` is given, the port
   * built here. Defaults to a fresh `:memory:` store when omitted (test
   * isolation). `serve()` (index.ts) supplies its on-disk store.
   */
  registryStore?: RegistryStore;
  /**
   * Composition + render + archive + enqueue deps. OPTIONAL and OFF by
   * default: a bare `createIngressServer()` never touches a renderer, the
   * filesystem archive, or the delivery queue — only `serve()` wires this
   * by default. Its `documentTypes` registry is the one the built port
   * reads (and the missing-businessEvent ordering check consults).
   */
  composition?: CompositionDeps;
  /** The document-type registry, when no `composition` carries one —
   * index.ts's wrapper passes the built-ins' registry here for bare test
   * servers. */
  documentTypes?: DocumentTypeRegistry;
  /**
   * The delivery queue backing the Operations console screen
   * (GET /output/operations). Optional, off by default like
   * `composition`; when absent, `/output/operations` 404s like any other
   * unknown path.
   */
  deliveryQueue?: DeliveryQueue;
  /** The backoff policy `deliveryQueue` was constructed with — the
   * Operations screen's `maxAttempts` column comes from here, never a
   * hardcoded `DEFAULT_BACKOFF_POLICY`. Required alongside `deliveryQueue`
   * for `/output/operations` to render (both or neither). */
  backoffPolicy?: BackoffPolicy;
}

export function createIngressServer(options: IngressServerOptions = {}) {
  const registryStore = options.registryStore ?? createSqliteRegistryStore(':memory:');
  const composition = options.composition;
  const documentTypes = options.documentTypes ?? composition?.documentTypes;
  const port: OutputPort =
    options.output ??
    createOutput({
      registryStore,
      ...(composition !== undefined
        ? {
            archiveStore: composition.archiveStore,
            deliveryQueue: composition.deliveryQueue,
            renderer: composition.renderer,
            ...(composition.renderers !== undefined ? { renderers: composition.renderers } : {}),
            ...(composition.retentionUntil !== undefined ? { retentionUntil: composition.retentionUntil } : {}),
          }
        : {}),
      ...(documentTypes !== undefined ? { documentTypes } : {}),
    });
  const deliveryQueue = options.deliveryQueue;
  const backoffPolicy = options.backoffPolicy;
  return createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      const path = url.split('?')[0];

      // Read-only console (ROADMAP Stage 3 "Minimal console, read-only",
      // docs/UI-DESIGN.md): GET-only, mounted at /output — see console.ts.
      if (isConsolePath(path)) {
        if (req.method !== 'GET') {
          sendProblem(res, methodNotAllowedProblem(req.method));
          return;
        }
        const query = new URL(url, 'http://localhost').searchParams;
        handleConsoleRequest(res, path, query, registryStore, deliveryQueue, backoffPolicy);
        return;
      }

      switch (path) {
        case '/event':
          if (req.method !== 'POST') {
            sendProblem(res, methodNotAllowedProblem(req.method));
            return;
          }
          await handleEvent(req, res, port, documentTypes);
          return;
        case '/render':
          if (req.method !== 'POST') {
            sendProblem(res, methodNotAllowedProblem(req.method));
            return;
          }
          await handleRender(req, res, port);
          return;
        case '/documents':
          if (req.method !== 'GET') {
            sendProblem(res, methodNotAllowedProblem(req.method));
            return;
          }
          await handleDocuments(res, new URL(url, 'http://localhost').searchParams, port);
          return;
        default:
          sendProblem(res, notFoundProblem(path));
      }
    })().catch(() => {
      // Last-resort guard: never leak an unhandled-exception stack (which may
      // embed payload data) — respond with an opaque problem+json instead.
      if (!res.headersSent) {
        sendProblem(res, {
          type: 'https://busy-office.dev/problems/internal-error',
          title: 'Internal error',
          status: 500,
          detail: 'An unexpected error occurred while processing the request.',
        });
      }
    });
  });
}
