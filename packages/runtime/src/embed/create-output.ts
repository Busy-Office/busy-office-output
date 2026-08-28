/**
 * `createOutput()` — the embeddable, topology-blind module API (ROADMAP
 * Stage 3 "Embeddable module (ADR-007)"; ADR-007's T1 "embedded module").
 *
 * ADR-007's package map calls this an `output-client` (OutputPort-compatible,
 * topology-blind caller): a host process (busy-office-erp, or any Node
 * process) mounts the SAME determination -> idempotency -> composition
 * pipeline `server.ts`'s HTTP ingress uses, without an HTTP server, a fixed
 * SQLite file path, or any other opinion about deployment topology. Every
 * backend (`RegistryStore`, `ArchiveStore`, `DeliveryQueue`, `Renderer`) is
 * INJECTED by the caller — this module builds none of them; `createRuntimeDeps`
 * (index.ts) is what wires the zero-external-services defaults `serve()`
 * uses, and a caller wanting those same defaults can call it directly and
 * pass the pieces through, exactly like a test would.
 *
 * `submitEvent` reuses `determine()` (determination/) and
 * `composeRenderArchiveAndEnqueue` (composition.ts) verbatim — this module
 * does not reimplement rule evaluation, template resolution, rendering, or
 * archiving. What IS new here is closing the transactional-outbox gap
 * (registry/registry-store.ts's `mintWithOutbox`, composition.ts's
 * `resumeStrandedCompositions`) for the mint step every resolution goes
 * through: see those two files' header comments for the full mechanism.
 *
 * No PostgresRegistryStore: out of scope per this task's binding ruling
 * (same reasoning as why S3/email stayed mock-tested-only — no live
 * Postgres in this environment). The `RegistryStore` port itself is
 * already backend-agnostic; a host wanting to share its own Postgres
 * transaction with this pipeline supplies a `RegistryStore` implementation
 * of its own — that implementation is host-side work, not built here.
 */
import type { DataContractEnvelope, Renderer, TemplateMeta } from '@busy-office/output-schema';
import type { BusinessEventKey } from '@busy-office/output-schema';
import type { RegistryStore } from '../registry/registry-store.js';
import type { ArchiveStore } from '../archive/archive-store.js';
import type { DeliveryQueue } from '../delivery/delivery-queue.js';
import type { SchemaValidationError } from '../problem.js';
import { isKnownDocumentType, validateContract, type DocumentType } from '../contract-validation.js';
import {
  determine,
  loadOutputRules,
  loadTemplateCandidates,
  type DeterminationContext,
  type DeterminationTrace,
  type OutputRule,
  type Resolution,
} from '../determination/index.js';
import {
  composeRenderArchiveAndEnqueue,
  resumeStrandedCompositions,
  type CompositionDeps,
  type CompositionOutcome,
  type ResumeOutcome,
} from '../composition.js';

export interface CreateOutputDeps {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
  deliveryQueue: DeliveryQueue;
  renderer: Renderer;
  /** Returns an RFC 3339 timestamp for a freshly-archived artifact's
   * mandatory retentionUntil. Passed straight through to
   * `composeRenderArchiveAndEnqueue` — see composition.ts for the default. */
  retentionUntil?: () => string;
  /** Override the files-first rule/template sources (ADR-003 default:
   * `loadOutputRules()` / `loadTemplateCandidates()`, the same
   * `packages/runtime/rules/*` files `server.ts` reads). Mainly for tests
   * that want a hermetic rule set without touching the repo's real rules
   * directory; a host embedding this module normally leaves these unset. */
  rules?: readonly OutputRule[];
  templateCandidates?: readonly TemplateMeta[];
}

export interface SubmitEventInput {
  /** The raw data-contract payload (packages/schema/contracts/*.schema.json
   * shape) — NOT wrapped in a CloudEvents envelope; that unwrapping is
   * server.ts's ingress-transport concern, not this module's (a host
   * embedding this module already has its own event, in its own shape, by
   * the time it calls `submitEvent`). */
  payload: unknown;
  documentType: unknown;
  businessEvent: BusinessEventKey;
  /** Optional routing hints beyond documentType/businessEvent — see
   * server.ts's `extractDeterminationContext` for the same fields on the
   * HTTP path. */
  determination?: Partial<Pick<DeterminationContext, 'companyCode' | 'country' | 'partnerId' | 'locale'>>;
}

/** One resolution's outcome from `submitEvent`. `composition` is `{ outcome:
 * 'replayed' }` when this resolution's docId already existed AND its
 * transactional-outbox work was already complete — the common, cheap replay
 * path. When a replay finds STRANDED outbox work (a prior crash), it is
 * redriven inline before returning, and `composition` carries the real
 * `CompositionOutcome` exactly as a first sighting would. */
export interface SubmitResolutionResult {
  docId: string;
  replayed: boolean;
  ruleId: string;
  templateId: string;
  templateVersion: string;
  channel: string;
  recipients: string[];
  locale?: string;
  composition: CompositionOutcome | { outcome: 'replayed' };
}

export type SubmitEventResult =
  | { status: 'unknown-document-type'; documentType: unknown }
  | { status: 'invalid-contract'; documentType: DocumentType; errors: SchemaValidationError[] }
  | { status: 'no-rule-match'; trace: DeterminationTrace }
  | { status: 'no-template-match'; trace: DeterminationTrace }
  | { status: 'accepted'; documentType: DocumentType; resolutions: SubmitResolutionResult[] };

export interface OutputPort {
  /**
   * Validate, determine, and (for every newly-minted or previously-stranded
   * resolution) compose+render+archive+enqueue one event. Mirrors
   * server.ts's `handleEvent` pipeline exactly, minus the HTTP/CloudEvents
   * transport — see this module's header comment.
   */
  submitEvent(input: SubmitEventInput): Promise<SubmitEventResult>;

  /**
   * Redrive every composition_outbox row still pending past `minAgeMs`
   * (default 0) — see composition.ts's `resumeStrandedCompositions`. A host
   * embedding this module should call this once after process start (before
   * or after resuming normal traffic; `submitEvent` also self-heals stranded
   * work it happens to encounter on a replay, so this is a sweep for
   * anything that never gets replayed) to close the crash-recovery loop.
   */
  resumeStrandedCompositions(minAgeMs?: number): Promise<ResumeOutcome[]>;
}

/**
 * Assemble the embeddable Output API from caller-supplied ports. Building
 * nothing itself: no HTTP server, no hardcoded SQLite path, no filesystem
 * archive root — those are `serve()`'s (index.ts) job for standalone runs.
 * A host wanting the same zero-external-services defaults can call
 * `createRuntimeDeps()` and pass `deps.composition`'s pieces straight
 * through:
 *
 * ```ts
 * const { registryStore, archiveStore, deliveryQueue, composition } = createRuntimeDeps(hostDbPath);
 * const output = createOutput({ registryStore, archiveStore, deliveryQueue, renderer: composition.renderer });
 * ```
 */
export function createOutput(deps: CreateOutputDeps): OutputPort {
  const composition: CompositionDeps = {
    registryStore: deps.registryStore,
    archiveStore: deps.archiveStore,
    deliveryQueue: deps.deliveryQueue,
    renderer: deps.renderer,
    ...(deps.retentionUntil !== undefined ? { retentionUntil: deps.retentionUntil } : {}),
  };
  const rules = deps.rules ?? loadOutputRules();
  const templateCandidates = deps.templateCandidates ?? loadTemplateCandidates();

  async function submitOneResolution(
    businessEvent: BusinessEventKey,
    resolution: Resolution,
    data: DataContractEnvelope,
    documentType: DocumentType,
  ): Promise<SubmitResolutionResult> {
    // Transactional outbox (registry/registry-store.ts's `mintWithOutbox`,
    // migrations/0005_add_composition_outbox.sql): mint the docId AND
    // durably record the composition work it owes, atomically. A crash
    // right after this call returns is never a lost write — either this
    // call, a later `submitEvent` replay, or `resumeStrandedCompositions`
    // will find the outbox row and finish the work.
    const { row, created } = deps.registryStore.mintWithOutbox(
      { ...businessEvent, ruleId: resolution.ruleId },
      resolution,
      data,
      documentType,
    );

    let composed: CompositionOutcome | { outcome: 'replayed' };
    if (created) {
      composed = await composeRenderArchiveAndEnqueue(composition, row.docId, resolution, data);
      deps.registryStore.clearOutboxEntry(row.docId);
    } else {
      // Replay of an already-seen resolution. Usually a cheap no-op — but
      // if a prior attempt crashed between mint and composition-complete,
      // its outbox row is still there; redrive it now instead of silently
      // returning `replayed` for work that was never actually finished.
      const pending = deps.registryStore.getOutboxEntry(row.docId);
      if (pending !== undefined) {
        composed = await composeRenderArchiveAndEnqueue(composition, row.docId, resolution, data);
        deps.registryStore.clearOutboxEntry(row.docId);
      } else {
        composed = { outcome: 'replayed' };
      }
    }

    return {
      docId: row.docId,
      replayed: !created,
      ruleId: resolution.ruleId,
      templateId: resolution.templateId,
      templateVersion: resolution.templateVersion,
      channel: resolution.channel,
      recipients: resolution.recipients,
      locale: resolution.locale,
      composition: composed,
    };
  }

  return {
    async submitEvent(input: SubmitEventInput): Promise<SubmitEventResult> {
      if (!isKnownDocumentType(input.documentType)) {
        return { status: 'unknown-document-type', documentType: input.documentType };
      }
      const documentType = input.documentType;

      const validation = validateContract(documentType, input.payload);
      if (!validation.valid) {
        return { status: 'invalid-contract', documentType, errors: validation.errors };
      }

      // Determination runs BEFORE any docId is minted (mirrors server.ts):
      // a no-match event never produces a registry row for work that was
      // never actually determined.
      const ctx: DeterminationContext = {
        documentType,
        businessObject: input.businessEvent.businessObject,
        event: input.businessEvent.event,
        ...input.determination,
      };
      const determination = determine(ctx, rules, templateCandidates);
      if (determination.outcome === 'no-rule-match') {
        return { status: 'no-rule-match', trace: determination.trace };
      }
      if (determination.outcome === 'no-template-match') {
        return { status: 'no-template-match', trace: determination.trace };
      }

      const resolutions = await Promise.all(
        determination.resolutions.map((resolution) =>
          submitOneResolution(input.businessEvent, resolution, input.payload as DataContractEnvelope, documentType),
        ),
      );

      return { status: 'accepted', documentType, resolutions };
    },

    async resumeStrandedCompositions(minAgeMs = 0): Promise<ResumeOutcome[]> {
      return resumeStrandedCompositions(composition, minAgeMs);
    },
  };
}
