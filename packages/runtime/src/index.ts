/**
 * Runtime entry point AND the one composition root (Stage 3: determination
 * + delivery, HLD §2; GAP-07/GAP-08). This is the only engine file that
 * knows a document type exists: it imports the built-in definitions from
 * `packages/runtime/document-types/` (outside `src/`) and registers them
 * through `OutputPort.registerDocumentType` — the built-ins round-trip
 * verb five themselves. Every other `src/**` file is document-type-blind
 * (`registration/engine-boundary.test.ts` enforces it).
 */
export { createContractCompiler } from './contract-validation.js';
export type { ContractValidationResult, ContractCompiler, ContractCompileResult, CompiledContract } from './contract-validation.js';
export { createDocumentTypeRegistry } from './registration/document-type-registry.js';
export type { DocumentTypeRegistry } from './registration/document-type-registry.js';
export type {
  DocumentTypeDefinition,
  RegisteredTemplate,
  RegistrationProblem,
  RegistrationResult,
} from './registration/document-type-definition.js';
export { CHANNELS_REQUIRING_MESSAGE, checkMessageTemplate, messageTemplateExpressions, renderMessage } from './message/message-template.js';
export type { MessageSegment, MessageTemplate, MessageTemplateMeta, RenderedMessage } from './message/message-template.js';
export type { ProblemDetails, SchemaValidationError } from './problem.js';
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
  TemplateLifecycleEvent,
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
  DeliveryMessage,
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
export { determine, loadRulesFromDir, loadTemplateMetasFromDir } from './determination/index.js';
export type { DeterminationResult, OutputRule, OutputRuleConditions, OutputRuleResolution, DeterminationContext, CallerDeterminationContext, DeterminationTrace, DeterminationOutcome, RecipientsSource, ResolutionTrace, RuleTraceEntry, TemplateTraceEntry } from './determination/index.js';
export {
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
export { createTemplateLifecycle } from './lifecycle/template-lifecycle.js';
export type { TemplateLifecycleService, TemplateLifecycleKey, TransitionResult, SeedOutcome } from './lifecycle/template-lifecycle.js';
export { LIFECYCLE_TRANSITIONS, evaluateTransition } from './lifecycle/transitions.js';
export type { LifecycleTransition, TransitionRefusal, TransitionVerb } from './lifecycle/transitions.js';
export { createDefaultAuthorizationPort, extractOwnerId } from './authorization/authorization-port.js';
export type { AuthorizationPort, Actor, ReprintAction } from './authorization/authorization-port.js';
export type {
  CreateOutputDeps,
  OutputPort,
  EmitInput,
  EmitResult,
  EmitResolutionResult,
  PreviewInput,
  PreviewResult,
  DocumentStatus,
  ReproduceInput,
  ReproduceResult,
} from './embed/create-output.js';
export { submitResolution } from './submit-resolution.js';
export type { SubmitResolutionOutcome } from './submit-resolution.js';
export { drainOnce, startWorker } from './worker.js';
export type { Worker } from './worker.js';
export type { IngressServerOptions } from './server.js';

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createIngressServer as createIngressServerRaw, type IngressServerOptions } from './server.js';
import { createOutput, type OutputPort } from './embed/create-output.js';
import { createDocumentTypeRegistry, type DocumentTypeRegistry } from './registration/document-type-registry.js';
import { builtinDocumentTypes } from '../document-types/index.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import type { RegistryStore } from './registry/registry-store.js';
import { FsArchiveStore } from './archive/fs-archive-store.js';
import type { ArchiveStore } from './archive/archive-store.js';
import { createSqliteDeliveryQueue } from './delivery/sqlite-delivery-queue.js';
import { DEFAULT_BACKOFF_POLICY, type BackoffPolicy, type DeliveryQueue } from './delivery/delivery-queue.js';
import { FsChannelSender } from './delivery/fs-channel-sender.js';
import { TypstRenderer } from '@busy-office/render-typst';
import { PdfDirectRenderer } from '@busy-office/render-pdf-direct';
import type { CompositionDeps, ResumeOutcome } from './composition.js';
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
 * archive, delivery queue, renderer, and the derived composition/
 * channel-sender wrappers that sit on top of them (idempotency is the
 * registry's own `getOrCreateByResolutionKey` / `mintWithOutbox`, reached
 * only through submit-resolution.ts — no separate facade). `serve()`
 * builds one of these with the default on-disk paths; exported separately
 * so a caller (or a test wanting the exact wiring `serve()` uses, without
 * the HTTP `listen()` call or the real interval-driven worker) can build
 * the same pieces against different paths.
 */
export interface RuntimeDeps {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
  deliveryQueue: DeliveryQueue;
  composition: CompositionDeps;
  /** The document-type registry `composition` and `output` share. The
   * three built-ins are already registered in it (through `output`). */
  documentTypes: DocumentTypeRegistry;
  /** OutputPort v1 over these backends — the port `serve()` mounts, with
   * the built-in document types registered through its own fifth verb. */
  output: OutputPort;
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
  const documentTypes = createDocumentTypeRegistry();
  const composition: CompositionDeps = { registryStore, archiveStore, deliveryQueue, documentTypes, renderer, renderers };
  const output = createOutput({ registryStore, archiveStore, deliveryQueue, renderer, renderers, documentTypes });
  registerBuiltinDocumentTypes(output);
  return { registryStore, archiveStore, deliveryQueue, composition, documentTypes, output, channelSender, backoffPolicy };
}

/**
 * Register the three built-in document types (`packages/runtime/
 * document-types/`) through the port's own fifth verb — the ONLY place
 * the engine meets a concrete document type (GAP-08). Order is the
 * definitions' own (see document-types/index.ts). A non-`registered`
 * result here is a wiring bug in this repo, not a runtime condition, so
 * it throws at startup rather than serving a half-registered runtime.
 */
export function registerBuiltinDocumentTypes(port: OutputPort): void {
  for (const definition of builtinDocumentTypes) {
    const result = port.registerDocumentType(definition);
    if (result.status !== 'registered') {
      throw new Error(
        `built-in document type "${definition.documentType}" failed to register: ${JSON.stringify(result)}`,
      );
    }
  }
}

/**
 * `createIngressServer` with the built-in document types registered —
 * the composition-root flavor most tests (and `serve()`) want. Passing an
 * explicit `output` or a `composition` (whose registry already holds what
 * `createRuntimeDeps` registered) hands straight through to server.ts;
 * otherwise a bare, determination-only port is built over `registryStore`
 * (default `:memory:`) with the built-ins registered through
 * `registerDocumentType`, exactly as `serve()` does for the real thing.
 */
export function createIngressServer(options: IngressServerOptions = {}) {
  if (options.output !== undefined || options.composition !== undefined || options.documentTypes !== undefined) {
    return createIngressServerRaw(options);
  }
  const registryStore = options.registryStore ?? createSqliteRegistryStore(':memory:');
  const documentTypes = createDocumentTypeRegistry();
  const output = createOutput({ registryStore, documentTypes });
  registerBuiltinDocumentTypes(output);
  return createIngressServerRaw({ ...options, registryStore, documentTypes, output });
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
  // `deps.output` already carries the three built-ins (registered through
  // its own `registerDocumentType` in createRuntimeDeps) — the consumer
  // round-trip: POST /event → emit, POST /render → preview,
  // GET /documents → status, all over this one port.
  const server = createIngressServerRaw({
    output: deps.output,
    registryStore: deps.registryStore,
    composition: deps.composition,
    deliveryQueue: deps.deliveryQueue,
    backoffPolicy: deps.backoffPolicy,
  });
  const resumed: Promise<ResumeOutcome[]> = deps.output
    .resumeStrandedCompositions()
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
