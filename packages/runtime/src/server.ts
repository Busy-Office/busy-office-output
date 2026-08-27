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
import {
  invalidContractProblem,
  malformedRequestProblem,
  methodNotAllowedProblem,
  missingBusinessEventProblem,
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

  let payload: unknown;
  try {
    payload = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    // Never log the raw body (CLAUDE.md: no payloads in logs) — including in errors.
    sendProblem(res, malformedRequestProblem('Request body is not valid JSON.'));
    return;
  }

  // `businessEvent` is envelope metadata, not part of the data-contract
  // payload (whose schemas are additionalProperties:false) — validate the
  // contract against the payload with the envelope field stripped out.
  const documentPayload =
    payload !== null && typeof payload === 'object'
      ? (() => {
          const { businessEvent: _businessEvent, ...rest } = payload as Record<string, unknown>;
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

  // Idempotency (HLD §4): replay of the same four-tuple returns the SAME
  // docId, without re-running determination/fan-out/render/delivery (none
  // of which exist yet — this is ingress-only, but the response already
  // proves the contract). 202 on first sighting = new work accepted; 200 on
  // replay = here is the existing result, no new work was done.
  const { docId, replayed } = idempotencyStore.getOrCreate(businessEventKey);
  sendJson(res, replayed ? 200 : 202, { status: 'accepted', documentType, docId, replayed });
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
