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
export {
  DEFAULT_BACKOFF_POLICY,
  computeBackoffMs,
  SqliteDeliveryQueue,
  createSqliteDeliveryQueue,
  EmailChannelSender,
  ObjectStoreChannelSender,
  ChannelRouter,
  FsChannelSender,
} from './delivery/index.js';
export type {
  BackoffPolicy,
  ChannelSendInput,
  ChannelSender,
  DeliveryAttemptOutcome,
  DeliveryAttemptResult,
  DeliveryJob,
  DeliveryJobStatus,
  DeliveryQueue,
  EnqueueDeliveryInput,
  PoisonAlert,
  SqliteDeliveryQueueOptions,
  EmailChannelSenderOptions,
  SmtpConfig,
  TransporterLike,
  ObjectStoreChannelSenderOptions,
  ChannelSenderMap,
} from './delivery/index.js';
export { determine, loadOutputRules, loadTemplateCandidates } from './determination/index.js';
export type { DeterminationResult, OutputRule, OutputRuleConditions, OutputRuleResolution, DeterminationContext, DeterminationTrace, DeterminationOutcome, RuleTraceEntry, TemplateTraceEntry } from './determination/index.js';
export {
  invalidContractProblem,
  malformedCloudEventsProblem,
  malformedRequestProblem,
  methodNotAllowedProblem,
  missingBusinessEventProblem,
  noRuleMatchProblem,
  noTemplateMatchProblem,
  notFoundProblem,
  unknownDocumentTypeProblem,
} from './problem.js';
export { composeRenderArchiveAndEnqueue, defaultRetentionUntil } from './composition.js';
export type { CompositionDeps, CompositionOutcome } from './composition.js';
export { drainOnce, startWorker } from './worker.js';
export type { Worker } from './worker.js';
export { getTemplateContent } from './render/template-content.js';

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createIngressServer } from './server.js';
import { createRegistryIdempotencyStore, type IdempotencyStore } from './idempotency-store.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import type { RegistryStore } from './registry/registry-store.js';
import { FsArchiveStore } from './archive/fs-archive-store.js';
import type { ArchiveStore } from './archive/archive-store.js';
import { createSqliteDeliveryQueue } from './delivery/sqlite-delivery-queue.js';
import type { DeliveryQueue } from './delivery/delivery-queue.js';
import { FsChannelSender } from './delivery/fs-channel-sender.js';
import { TypstRenderer } from '@busy-office/render-typst';
import type { CompositionDeps } from './composition.js';
import { startWorker, type Worker } from './worker.js';

/**
 * Default on-disk location for the document registry in standalone
 * single-process mode. Overridable via `REGISTRY_DB_PATH` (e.g. for a
 * container with a mounted data volume). Not used by tests, which call
 * `createIngressServer()` directly and get its `:memory:` default.
 */
export function defaultRegistryDbPath(): string {
  return process.env.REGISTRY_DB_PATH ?? join(process.cwd(), 'data', 'registry.db');
}

/** Default on-disk root for the FS archive store — overridable via
 * `ARCHIVE_DIR`. Shares the `./data/` root with the registry DB and the
 * outbox below (all under the same gitignored `/data/`). */
export function defaultArchiveDir(): string {
  return process.env.ARCHIVE_DIR ?? join(process.cwd(), 'data', 'archive');
}

/** Default on-disk root for the FS delivery outbox — overridable via
 * `OUTBOX_DIR`. See `FsChannelSender`. */
export function defaultOutboxDir(): string {
  return process.env.OUTBOX_DIR ?? join(process.cwd(), 'data', 'outbox');
}

/**
 * The full set of backends a single-process runtime needs — registry,
 * archive, delivery queue, renderer, and the derived idempotency/
 * composition/channel-sender wrappers that sit on top of them. `serve()`
 * builds one of these with the default on-disk paths; exported separately
 * so a caller (or a test wanting the exact wiring `serve()` uses, without
 * the HTTP `listen()` call or the real interval-driven worker) can build
 * the same pieces against different paths.
 */
export interface RuntimeDeps {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
  deliveryQueue: DeliveryQueue;
  idempotencyStore: IdempotencyStore;
  composition: CompositionDeps;
  channelSender: FsChannelSender;
}

/**
 * Assemble the zero-external-services backends: SQLite registry (one file
 * also backs the delivery queue — see `SqliteDeliveryQueue`'s header
 * comment for why that's safe, WAL mode / separate connections), FS
 * archive, FS delivery outbox (`FsChannelSender`, the arb-chair-ruled
 * zero-external-services delivery default), and a real `TypstRenderer`.
 * `dbPath: ':memory:'` is honored the same way `defaultRegistryDbPath`
 * already documents (test isolation, no directory created).
 */
export function createRuntimeDeps(
  dbPath: string = defaultRegistryDbPath(),
  archiveDir: string = defaultArchiveDir(),
  outboxDir: string = defaultOutboxDir(),
): RuntimeDeps {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const registryStore = createSqliteRegistryStore(dbPath);
  const idempotencyStore = createRegistryIdempotencyStore(registryStore);
  const archiveStore = new FsArchiveStore(archiveDir);
  const deliveryQueue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore });
  const renderer = new TypstRenderer();
  const channelSender = new FsChannelSender(outboxDir);
  const composition: CompositionDeps = { registryStore, archiveStore, deliveryQueue, renderer };
  return { registryStore, archiveStore, deliveryQueue, idempotencyStore, composition, channelSender };
}

/**
 * Single-process `serve` (CLAUDE.md: "API + worker + embedded queue + FS
 * archive in one command"). Wires ingress + determination + composition
 * (render + archive + enqueue, ROADMAP Stage 3 "Single-process serve") +
 * a delivery worker loop into ONE function, all defaulting to local,
 * zero-external-services backends: SQLite registry, FS archive,
 * `FsChannelSender` delivery (arb-chair ruling). A replayed event returns
 * the same docId even across a restart of this process (durable registry).
 *
 * The returned `http.Server` has a `worker` property attached (the started
 * delivery-poll loop, `Worker.stop()` to halt it) so callers that need a
 * clean shutdown can do `server.worker.stop()` alongside `server.close()`.
 */
export function serve(port = 3000, dbPath: string = defaultRegistryDbPath()) {
  const deps = createRuntimeDeps(dbPath);
  const server = createIngressServer({ idempotencyStore: deps.idempotencyStore, composition: deps.composition });
  const worker: Worker = startWorker(deps.deliveryQueue, deps.channelSender);
  server.listen(port);
  return Object.assign(server, { worker });
}

// Allow `node src/index.ts` / `tsx src/index.ts` to start the server directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  serve(port);
  // eslint-disable-next-line no-console
  console.log(`busy-office-output runtime listening on :${port}`);
}
