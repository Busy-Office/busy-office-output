/**
 * Small shared HTTP response helpers (ROADMAP Stage 3). Split out of
 * server.ts (where they originated as private functions for the `/event`
 * route) so console.ts — the read-only `/output/*` console routes added by
 * "Minimal console, read-only" — can send the same RFC 9457 problem+json
 * shape and a plain HTML response, without server.ts and console.ts
 * importing each other.
 */
import type { ServerResponse } from 'node:http';
import type { ProblemDetails } from './problem.js';

export function sendProblem(res: ServerResponse, problem: ProblemDetails): void {
  const body = JSON.stringify(problem);
  res.writeHead(problem.status, {
    'Content-Type': 'application/problem+json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Plain server-rendered HTML — console.ts's only response shape besides `sendProblem`'s 404s. */
export function sendHtml(res: ServerResponse, status: number, html: string): void {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}
