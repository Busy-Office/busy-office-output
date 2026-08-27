/**
 * Event ingress (ROADMAP Stage 3 task 1; HLD §2 "Event API": validate,
 * contract, idempotency). Scoped to validate + contract + idempotency only —
 * determination/fan-out/registry/archive/delivery are separate, later tasks.
 * Idempotency here is backed by the durable document registry (registry/) —
 * see idempotency-store.ts's header comment. `createIngressServer()` with
 * no override defaults to an in-memory-backed registry (fast, isolated —
 * what tests use); `index.ts`'s `serve()` wires a real on-disk registry by
 * default for standalone single-process runs.
 *
 * Built on Node's built-in `http` module rather than a framework: a single
 * route (`POST /event`) with one job (parse JSON, validate against a JSON
 * Schema contract, respond) does not earn a routing/middleware layer, and
 * CLAUDE.md's single-process mandate ("API + worker + embedded queue + FS
 * archive in one command") favors keeping the dependency surface minimal
 * from the start.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { BusinessEventKey } from '@busy-office/output-schema';
import {
  isKnownDocumentType,
  validateContract,
  type DocumentType,
} from './contract-validation.js';
import {
  createRegistryIdempotencyStore,
  type IdempotencyStore,
} from './idempotency-store.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import { determine, loadOutputRules, loadTemplateCandidates, type DeterminationContext } from './determination/index.js';
import {
  invalidContractProblem,
  malformedCloudEventsProblem,
  malformedRequestProblem,
  methodNotAllowedProblem,
  missingBusinessEventProblem,
  noRuleMatchProblem,
  noTemplateMatchProblem,
  notFoundProblem,
  unknownDocumentTypeProblem,
  type ProblemDetails,
} from './problem.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MiB — guards against unbounded body reads

function sendProblem(res: ServerResponse, problem: ProblemDetails): void {
  const body = JSON.stringify(problem);
  res.writeHead(problem.status, {
    'Content-Type': 'application/problem+json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

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
 * envelope genuinely optional and reuses the same downstream ingress logic
 * either way (no duplicated validate/idempotency path per shape).
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

const BUSINESS_EVENT_KEY_FIELDS = ['businessObject', 'businessObjectId', 'event', 'templateVersion'] as const;

/**
 * Extract + validate the BusinessEventKey envelope. Design choice: the key
 * travels as a top-level `businessEvent` object sibling to the contract
 * payload's own fields (documentType, header, ...) — not as headers. This
 * mirrors how the ADR-006 CloudEvents envelope (a later, not-yet-built
 * task) will carry a `data` field alongside event metadata, so this shape
 * won't need reshaping when that lands; it also keeps the whole event in
 * one JSON body rather than splitting identity across headers + body.
 */
function extractBusinessEventKey(payload: unknown): BusinessEventKey | undefined {
  if (payload === null || typeof payload !== 'object' || !('businessEvent' in payload)) {
    return undefined;
  }
  const candidate = (payload as Record<string, unknown>).businessEvent;
  if (candidate === null || typeof candidate !== 'object') {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
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

const DETERMINATION_CONTEXT_FIELDS = ['companyCode', 'country', 'partnerId', 'locale'] as const;

/**
 * Determination's OPTIONAL, caller-supplied routing hints beyond
 * documentType/businessEvent — companyCode/country/partnerId/locale. None
 * of the frozen data contracts (packages/schema/contracts/) carry these at
 * top level, so a caller who wants finer-than-documentType-and-event rule
 * or template-variant routing supplies them via this sibling envelope
 * field, alongside `businessEvent`. Judgment call flagged in this task's
 * report: this is a new wire-level field this task introduces, not
 * specified by the task prompt itself. Absent entirely, determination
 * still works — rules/templates that only constrain documentType/event
 * match on wildcards for the rest (docs/VARIANT-RESOLUTION.md semantics).
 */
function extractDeterminationContext(payload: unknown): Partial<Pick<DeterminationContext, 'companyCode' | 'country' | 'partnerId' | 'locale'>> {
  if (payload === null || typeof payload !== 'object' || !('determination' in payload)) {
    return {};
  }
  const candidate = (payload as Record<string, unknown>).determination;
  if (candidate === null || typeof candidate !== 'object') {
    return {};
  }
  const record = candidate as Record<string, unknown>;
  const context: Partial<Pick<DeterminationContext, 'companyCode' | 'country' | 'partnerId' | 'locale'>> = {};
  for (const field of DETERMINATION_CONTEXT_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value !== '') {
      context[field] = value;
    }
  }
  return context;
}

async function handleEvent(
  req: IncomingMessage,
  res: ServerResponse,
  idempotencyStore: IdempotencyStore,
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendProblem(res, malformedRequestProblem('Failed to read request body.'));
    return;
  }

  let rawPayload: unknown;
  try {
    rawPayload = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    // Never log the raw body (CLAUDE.md: no payloads in logs) — including in errors.
    sendProblem(res, malformedRequestProblem('Request body is not valid JSON.'));
    return;
  }

  // Task 1 (ADR-006): optional CloudEvents 1.0 envelope. Detected + unwrapped
  // here so every downstream step (contract validation, businessEvent
  // extraction, determination) runs identically whether the caller sent the
  // raw shape or a CloudEvents-wrapped one — no duplicated ingress logic.
  let payload: unknown;
  try {
    payload = unwrapCloudEventsEnvelope(rawPayload);
  } catch (err) {
    sendProblem(res, malformedCloudEventsProblem(err instanceof Error ? err.message : 'Malformed CloudEvents envelope.'));
    return;
  }

  // `businessEvent` (and `determination`) are envelope metadata, not part of
  // the data-contract payload (whose schemas are additionalProperties:false)
  // — validate the contract against the payload with those fields stripped.
  const documentPayload =
    payload !== null && typeof payload === 'object'
      ? (() => {
          const { businessEvent: _businessEvent, determination: _determination, ...rest } = payload as Record<string, unknown>;
          return rest;
        })()
      : payload;

  const documentType = extractDocumentType(documentPayload);
  if (!isKnownDocumentType(documentType)) {
    sendProblem(res, unknownDocumentTypeProblem(documentType));
    return;
  }

  const result = validateContract(documentType as DocumentType, documentPayload);
  if (!result.valid) {
    sendProblem(res, invalidContractProblem(documentType, result.errors));
    return;
  }

  const businessEventKey = extractBusinessEventKey(payload);
  if (businessEventKey === undefined) {
    sendProblem(
      res,
      missingBusinessEventProblem(
        'Request body must carry a "businessEvent" object with businessObject, businessObjectId, event, and templateVersion (all non-empty strings).',
      ),
    );
    return;
  }

  // Determination (HLD §2/§9, ADR-003): rule evaluation is mandatory and
  // ALWAYS produces a TRACE, match or no-match. No rule/template match is a
  // loud 422 problem+json carrying that trace — never a silent 2xx
  // acceptance with nothing determined. Runs BEFORE idempotency so a
  // no-match event never mints a registry row / docId for work that was
  // never actually determined.
  const determinationContext: DeterminationContext = {
    documentType,
    businessObject: businessEventKey.businessObject,
    event: businessEventKey.event,
    ...extractDeterminationContext(payload),
  };
  const determination = determine(determinationContext, loadOutputRules(), loadTemplateCandidates());
  if (determination.outcome === 'no-rule-match') {
    sendProblem(res, noRuleMatchProblem(determination.trace));
    return;
  }
  if (determination.outcome === 'no-template-match') {
    sendProblem(res, noTemplateMatchProblem(determination.trace));
    return;
  }

  // Idempotency (HLD §4): replay of the same event returns the SAME docId(s),
  // without re-running fan-out/render/delivery (none of which exist yet —
  // this is ingress + determination only, but the response already proves
  // the contract). One resolution per firing rule (ROADMAP Stage 3
  // "Fan-out"): each gets its OWN idempotency lookup, keyed on the
  // four-tuple plus the firing ruleId (idempotency-store.ts's
  // `getOrCreateForResolution`), so a replayed event returns the same N
  // docIds, never 2N. 202 if any resolution was newly minted this call; 200
  // only when every resolution was already seen (a pure replay).
  const results = determination.resolutions.map((resolution) => {
    const { docId, replayed } = idempotencyStore.getOrCreateForResolution(businessEventKey, resolution.ruleId);
    return {
      docId,
      replayed,
      ruleId: resolution.ruleId,
      templateId: resolution.templateId,
      templateVersion: resolution.templateVersion,
      channel: resolution.channel,
      recipients: resolution.recipients,
      locale: resolution.locale,
    };
  });
  const allReplayed = results.every((r) => r.replayed);
  // Back-compat primary fields (docId/determination) mirror the FIRST
  // resolution — for the common single-rule-fires case this is byte-for-
  // -byte what callers got before fan-out existed. `resolutions` carries
  // every resolution for callers that need the full fan-out set.
  const [primary] = results;
  sendJson(res, allReplayed ? 200 : 202, {
    status: 'accepted',
    documentType,
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
    trace: determination.trace,
  });
}

export function createIngressServer(options: { idempotencyStore?: IdempotencyStore } = {}) {
  // Default: an in-memory (`:memory:`) SQLite-backed registry — fast and
  // isolated, so `server.test.ts` / `idempotency.test.ts` can call
  // `createIngressServer()` with no setup and get their own throwaway
  // database. `index.ts`'s `serve()` overrides this with a durable,
  // on-disk-backed store for standalone single-process runs.
  const idempotencyStore = options.idempotencyStore ?? createRegistryIdempotencyStore(createSqliteRegistryStore(':memory:'));
  return createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      const path = url.split('?')[0];

      if (path !== '/event') {
        sendProblem(res, notFoundProblem(path));
        return;
      }
      if (req.method !== 'POST') {
        sendProblem(res, methodNotAllowedProblem(req.method));
        return;
      }
      await handleEvent(req, res, idempotencyStore);
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
