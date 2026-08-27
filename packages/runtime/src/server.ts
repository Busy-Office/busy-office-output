/**
 * Event ingress (ROADMAP Stage 3 task 1; HLD §2 "Event API": validate,
 * contract, idempotency). This task is scoped to validate + contract only —
 * determination/fan-out/registry/archive/delivery are separate, later tasks.
 *
 * Built on Node's built-in `http` module rather than a framework: a single
 * route (`POST /event`) with one job (parse JSON, validate against a JSON
 * Schema contract, respond) does not earn a routing/middleware layer, and
 * CLAUDE.md's single-process mandate ("API + worker + embedded queue + FS
 * archive in one command") favors keeping the dependency surface minimal
 * from the start.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  isKnownDocumentType,
  validateContract,
  type DocumentType,
} from './contract-validation.js';
import {
  invalidContractProblem,
  malformedRequestProblem,
  methodNotAllowedProblem,
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

async function handleEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  const documentType = extractDocumentType(payload);
  if (!isKnownDocumentType(documentType)) {
    sendProblem(res, unknownDocumentTypeProblem(documentType));
    return;
  }

  const result = validateContract(documentType as DocumentType, payload);
  if (!result.valid) {
    sendProblem(res, invalidContractProblem(documentType, result.errors));
    return;
  }

  // Contract-valid: accepted. Determination/fan-out/registry/archive/delivery
  // are separate, not-yet-reached Stage 3 tasks — this is ingress-only.
  sendJson(res, 202, { status: 'accepted', documentType });
}

export function createIngressServer() {
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
      await handleEvent(req, res);
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
