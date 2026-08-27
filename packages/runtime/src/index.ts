/**
 * Runtime entry point (Stage 3: determination + delivery, HLD §2).
 * Currently exports only the Event API ingress; determination/fan-out/
 * registry/archive/delivery land here as their own Stage 3 tasks land.
 */
export { createIngressServer } from './server.js';
export { validateContract, isKnownDocumentType, KNOWN_DOCUMENT_TYPES } from './contract-validation.js';
export type { DocumentType, ContractValidationResult } from './contract-validation.js';
export type { ProblemDetails, SchemaValidationError } from './problem.js';

import { createIngressServer } from './server.js';

/**
 * Single-process `serve` (CLAUDE.md: "API + worker + embedded queue + FS
 * archive in one command"). Only the API ingress exists yet; worker/queue/
 * archive wiring join this function as their tasks land.
 */
export function serve(port = 3000) {
  const server = createIngressServer();
  server.listen(port);
  return server;
}

// Allow `node src/index.ts` / `tsx src/index.ts` to start the server directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  serve(port);
  // eslint-disable-next-line no-console
  console.log(`busy-office-output runtime listening on :${port}`);
}
