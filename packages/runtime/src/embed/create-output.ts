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
 * `submitEvent` reuses `determine()` (determination/) and the shared
 * per-resolution mint -> compose -> clear-outbox step (submit-resolution.ts,
 * which server.ts's HTTP path also calls — GAP-11) verbatim — this module
 * does not reimplement rule evaluation, template resolution, rendering,
 * archiving, or the transactional-outbox mint (registry/registry-store.ts's
 * `mintWithOutbox`, composition.ts's `resumeStrandedCompositions`): see
 * those files' header comments for the full mechanism.
 *
 * No PostgresRegistryStore: out of scope per this task's binding ruling
 * (same reasoning as why S3/email stayed mock-tested-only — no live
 * Postgres in this environment). The `RegistryStore` port itself is
 * already backend-agnostic; a host wanting to share its own Postgres
 * transaction with this pipeline supplies a `RegistryStore` implementation
 * of its own — that implementation is host-side work, not built here.
 */
import { randomUUID } from 'node:crypto';
import type { DataContractEnvelope, Renderer, TemplateMeta } from '@busy-office/output-schema';
import type { BusinessEventKey } from '@busy-office/output-schema';
import type { RegistryStore } from '../registry/registry-store.js';
import type { ArchiveStore } from '../archive/archive-store.js';
import type { DeliveryQueue } from '../delivery/delivery-queue.js';
import type { SchemaValidationError } from '../problem.js';
import { isKnownDocumentType, validateContract, type DocumentType } from '../contract-validation.js';
import { extractPayslipOwnerId } from '../authorization/authorization-port.js';
import {
  determine,
  loadOutputRules,
  loadTemplateCandidates,
  type CallerDeterminationContext,
  type DeterminationContext,
  type DeterminationTrace,
  type OutputRule,
  type Resolution,
} from '../determination/index.js';
import {
  resumeStrandedCompositions,
  type CompositionDeps,
  type CompositionOutcome,
  type ResumeOutcome,
} from '../composition.js';
import { submitResolution } from '../submit-resolution.js';

/**
 * Same shape validation server.ts's `extractDeterminationContext` applies
 * on the wire: string fields must be non-empty strings; `recipients` must
 * be a non-empty array of non-empty strings. Anything else is dropped
 * (treated as absent) so determination decides loudly rather than a
 * malformed value slipping into a delivery job. Nothing more — no
 * address parsing, no directory lookup (HLD §1).
 */
function sanitizeCallerDeterminationContext(input: CallerDeterminationContext | undefined): CallerDeterminationContext {
  if (input === undefined) return {};
  const out: CallerDeterminationContext = {};
  for (const field of ['companyCode', 'country', 'partnerId', 'locale'] as const) {
    const value: unknown = input[field];
    if (typeof value === 'string' && value !== '') out[field] = value;
  }
  const recipients: unknown = input.recipients;
  if (Array.isArray(recipients) && recipients.length > 0 && recipients.every((r) => typeof r === 'string' && r !== '')) {
    out.recipients = recipients as string[];
  }
  return out;
}

export interface CreateOutputDeps {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
  deliveryQueue: DeliveryQueue;
  renderer: Renderer;
  /** Returns an RFC 3339 timestamp for a freshly-archived artifact's
   * mandatory retentionUntil, given the resolved `documentType`. Passed
   * straight through to `composeRenderArchiveAndEnqueue` — see
   * composition.ts for the per-document-type default. */
  retentionUntil?: (documentType: string) => string;
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
   * HTTP path. `recipients` is caller-supplied master data (arb-chair
   * ruling, Stage 4 clause 2) that a rule may override; shape-validated
   * here exactly as on the HTTP path (array of non-empty strings) and
   * nothing more. */
  determination?: CallerDeterminationContext;
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
  | { status: 'unresolved-recipients'; trace: DeterminationTrace }
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
    // Transactional outbox mint -> compose -> clear-outbox lives in ONE
    // shared step (../submit-resolution.ts) that server.ts's HTTP path
    // calls too (GAP-11) — never re-implement it here.
    const outcome = await submitResolution(
      deps.registryStore,
      composition,
      businessEvent,
      resolution,
      data,
      documentType,
      extractPayslipOwnerId(documentType, data),
    );
    // `composition` deps are always supplied on this path, so the shared
    // step never returns `undefined` here; the fallback is type-only.
    const composed: CompositionOutcome | { outcome: 'replayed' } = outcome.composition ?? { outcome: 'replayed' };

    return {
      docId: outcome.docId,
      replayed: outcome.replayed,
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
        ...sanitizeCallerDeterminationContext(input.determination),
      };
      const determination = determine(ctx, rules, templateCandidates);
      // Persist the TRACE on every outcome, mirroring server.ts exactly
      // (HLD §9: the trace is mandatory; the Rule trace console screen
      // reads trace_log). This path used to DROP it — the 8,000-doc bench
      // runs through here, so its traces were never persisted. Non-match:
      // a fresh id (no docId exists); matched: the PRIMARY docId, after
      // mint — `INSERT OR IGNORE` makes a replay a no-op.
      if (determination.outcome === 'no-rule-match') {
        deps.registryStore.appendTraceLog(randomUUID(), determination.trace);
        return { status: 'no-rule-match', trace: determination.trace };
      }
      if (determination.outcome === 'no-template-match') {
        deps.registryStore.appendTraceLog(randomUUID(), determination.trace);
        return { status: 'no-template-match', trace: determination.trace };
      }
      if (determination.outcome === 'unresolved-recipients') {
        deps.registryStore.appendTraceLog(randomUUID(), determination.trace);
        return { status: 'unresolved-recipients', trace: determination.trace };
      }

      const resolutions = await Promise.all(
        determination.resolutions.map((resolution) =>
          submitOneResolution(input.businessEvent, resolution, input.payload as DataContractEnvelope, documentType),
        ),
      );
      const [primary] = resolutions;
      deps.registryStore.appendTraceLog(primary.docId, determination.trace);

      return { status: 'accepted', documentType, resolutions };
    },

    async resumeStrandedCompositions(minAgeMs = 0): Promise<ResumeOutcome[]> {
      return resumeStrandedCompositions(composition, minAgeMs);
    },
  };
}
