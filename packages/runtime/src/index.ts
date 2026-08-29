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
  OutboxEntry,
} from './registry/index.js';
export {
  FsArchiveStore,
  S3ArchiveStore,
  assertValidRetentionUntil,
  archiveArtifact,
  retentionUntilFor,
  retentionYearsFor,
  enforceRetention,
} from './archive/index.js';
export type {
  ArchiveStore,
  ArchiveInput,
  S3ArchiveStoreOptions,
  S3ClientLike,
  ArchiveArtifactInput,
  RetentionEnforcementDeps,
  RetentionPurgeResult,
} from './archive/index.js';
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
export {
  composeRenderArchiveAndEnqueue,
  composeConcatenatedRenderArchiveAndEnqueue,
  defaultRetentionUntil,
  resumeStrandedCompositions,
} from './composition.js';
export type { CompositionDeps, CompositionOutcome, ResumeOutcome } from './composition.js';
export { renderCoverSheet, coverSheetTemplate, coverSheetData, COVER_SHEET_DOC_TYPE } from './render/cover-sheet.js';
export type { CoverSheetHeader } from './render/cover-sheet.js';
export { createOutput } from './embed/create-output.js';
export { defaultAuthorizationPort, extractPayslipOwnerId } from './authorization/authorization-port.js';
export type { AuthorizationPort, Actor, ReprintAction } from './authorization/authorization-port.js';
export type {
  CreateOutputDeps,
  OutputPort,
  SubmitEventInput,
  SubmitEventResult,
  SubmitResolutionResult,
} from './embed/create-output.js';
export { submitResolution } from './submit-resolution.js';
export type { SubmitResolutionOutcome } from './submit-resolution.js';
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
import { DEFAULT_BACKOFF_POLICY, type BackoffPolicy, type DeliveryQueue } from './delivery/delivery-queue.js';
import { FsChannelSender } from './delivery/fs-channel-sender.js';
import { TypstRenderer } from '@busy-office/render-typst';
import { PdfDirectRenderer } from '@busy-office/render-pdf-direct';
import { resumeStrandedCompositions, type CompositionDeps, type ResumeOutcome } from './composition.js';
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
  /** The `BackoffPolicy` `deliveryQueue` was constructed with — threaded
   * through to the Operations console screen (console.ts) so its
   * `maxAttempts` column reflects reality instead of hardcoding
   * `DEFAULT_BACKOFF_POLICY`. */
  backoffPolicy: BackoffPolicy;
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
  const backoffPolicy = DEFAULT_BACKOFF_POLICY;
  const deliveryQueue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore, backoffPolicy });
  // Renderer registry (ADR-002 Accepted): Typst is the default and the
  // volume renderer; pdf-direct is the in-process second path a template
  // opts into via `TemplateMeta.renderer: "pdf-direct"` (see
  // composition.ts's `selectRenderer` for the routing decision point).
  const renderer = new TypstRenderer();
  const pdfDirect = new PdfDirectRenderer();
  const renderers = { [renderer.id]: renderer, [pdfDirect.id]: pdfDirect };
  const channelSender = new FsChannelSender(outboxDir);
  const composition: CompositionDeps = { registryStore, archiveStore, deliveryQueue, renderer, renderers };
  return { registryStore, archiveStore, deliveryQueue, idempotencyStore, composition, channelSender, backoffPolicy };
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
 * Crash recovery (GAP-11): a previous run of this process may have died
 * between `mintWithOutbox` and composition-complete, leaving pending
 * `composition_outbox` rows. `serve()` redrives them ONCE at startup via
 * `resumeStrandedCompositions` — a one-time sweep, not a timer: in this
 * single-process topology nothing else mints against this registry, so
 * every pending row at startup is by definition stranded (minAgeMs 0), and
 * `submitResolution` self-heals any stranded row a later replay happens to
 * hit. The sweep runs concurrently with `listen()` (it never blocks
 * ingress; a request arriving mid-sweep for the same docId is safe —
 * `clearOutboxEntry` is idempotent and `resumeStrandedCompositions` skips
 * rows whose archiveRef is already set). It is exposed as the returned
 * server's `resumed` promise so a caller/test can await it. Only docIds
 * are logged, never payloads.
 *
 * The returned `http.Server` has a `worker` property attached (the started
 * delivery-poll loop, `Worker.stop()` to halt it) so callers that need a
 * clean shutdown can do `server.worker.stop()` alongside `server.close()`.
 */
export function serve(port = 3000, dbPath: string = defaultRegistryDbPath()) {
  const deps = createRuntimeDeps(dbPath);
  const server = createIngressServer({
    registryStore: deps.registryStore,
    composition: deps.composition,
    deliveryQueue: deps.deliveryQueue,
    backoffPolicy: deps.backoffPolicy,
  });
  const resumed: Promise<ResumeOutcome[]> = resumeStrandedCompositions(deps.composition)
    .then((outcomes) => {
      if (outcomes.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[serve] resumed ${outcomes.length} stranded composition(s): ${outcomes.map((o) => o.docId).join(', ')}`);
      }
      return outcomes;
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[serve] stranded-composition resume failed', err instanceof Error ? err.message : String(err));
      return [] as ResumeOutcome[];
    });
  const worker: Worker = startWorker(deps.deliveryQueue, deps.channelSender);
  server.listen(port);
  return Object.assign(server, { worker, resumed });
}

// Allow `node src/index.ts` / `tsx src/index.ts` to start the server directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  serve(port);
  // eslint-disable-next-line no-console
  console.log(`busy-office-output runtime listening on :${port}`);
}
