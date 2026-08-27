/**
 * Runtime entry point (Stage 3: determination + delivery, HLD §2).
 * Currently exports the Event API ingress and the document registry;
 * determination/fan-out/archive/delivery land here as their own Stage 3
 * tasks land.
 */
export { createIngressServer } from './server.js';
export { validateContract, isKnownDocumentType, KNOWN_DOCUMENT_TYPES } from './contract-validation.js';
export type { DocumentType, ContractValidationResult } from './contract-validation.js';
export type { ProblemDetails, SchemaValidationError } from './problem.js';
export { createRegistryIdempotencyStore } from './idempotency-store.js';
export type { IdempotencyStore, IdempotencyResult } from './idempotency-store.js';
export {
  createSqliteRegistryStore,
  SqliteRegistryStore,
  runMigrations,
  DEFAULT_MIGRATIONS_DIR,
} from './registry/index.js';
export type {
  RegistryStore,
  DocumentRegistryRow,
  DocumentState,
  DeliveryHistoryEvent,
  GetOrCreateResult,
} from './registry/index.js';
export { FsArchiveStore, S3ArchiveStore, assertValidRetentionUntil, archiveArtifact } from './archive/index.js';
export type { ArchiveStore, ArchiveInput, S3ArchiveStoreOptions, S3ClientLike, ArchiveArtifactInput } from './archive/index.js';

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createIngressServer } from './server.js';
import { createRegistryIdempotencyStore } from './idempotency-store.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';

/**
 * Default on-disk location for the document registry in standalone
 * single-process mode. Overridable via `REGISTRY_DB_PATH` (e.g. for a
 * container with a mounted data volume). Not used by tests, which call
 * `createIngressServer()` directly and get its `:memory:` default.
 */
export function defaultRegistryDbPath(): string {
  return process.env.REGISTRY_DB_PATH ?? join(process.cwd(), 'data', 'registry.db');
}

/**
 * Single-process `serve` (CLAUDE.md: "API + worker + embedded queue + FS
 * archive in one command"). Backs the Event API's idempotency with a real,
 * durable, on-disk SQLite-backed document registry by default — a replayed
 * event returns the same docId even across a restart of this process.
 * worker/queue/archive wiring join this function as their tasks land.
 */
export function serve(port = 3000, dbPath: string = defaultRegistryDbPath()) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const registryStore = createSqliteRegistryStore(dbPath);
  const idempotencyStore = createRegistryIdempotencyStore(registryStore);
  const server = createIngressServer({ idempotencyStore });
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
