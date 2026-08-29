/**
 * `createOutput()` — the embeddable, topology-blind module API (ROADMAP
 * Stage 3 "Embeddable module (ADR-007)"; ADR-007's T1 "embedded module"),
 * now carrying **OutputPort v1** — the five-verb consumer contract the
 * GAP-07/GAP-08 arb-chair ruling (2026-08-29, docs/GAP-REGISTER.md; ADR-007
 * addendum, Proposed) fixed:
 *
 *   emit                   validate → determine → mint → compose → archive → enqueue
 *   preview                render only — no registry row, archive, delivery, trace, or docId
 *   status                 registry read by BusinessEventKey → DocumentStatus[] (one per ruleId)
 *   reproduce              Stage 5 — v1 returns { status: 'not-implemented' } and touches nothing
 *   registerDocumentType   synchronous, process-local, in-order, no unregister (GAP-08)
 *   resumeStrandedCompositions   operational — unchanged
 *
 * A host process (or this repo's own `serve()` — index.ts, the ONE
 * consumer that round-trips every verb over HTTP) mounts the SAME
 * determination -> idempotency -> composition pipeline through this port,
 * without an HTTP server, a fixed SQLite file path, or any other opinion
 * about deployment topology. Every backend (`RegistryStore`,
 * `ArchiveStore`, `DeliveryQueue`, `Renderer`) is INJECTED — this module
 * builds none of them; `createRuntimeDeps` (index.ts) wires the
 * zero-external-services defaults `serve()` uses.
 *
 * The port knows NO document type of its own (GAP-08): contracts,
 * templates, and rules arrive through `registerDocumentType` and live in
 * the `DocumentTypeRegistry` this port reads. The composition root
 * registers the built-ins; a host registers its own. Nothing here scans a
 * directory or imports a document type.
 *
 * `emit` reuses `determine()` (determination/) and the shared
 * per-resolution mint -> compose -> clear-outbox step (submit-resolution.ts,
 * GAP-11) verbatim — this module does not reimplement rule evaluation,
 * template resolution, rendering, archiving, or the transactional-outbox
 * mint (registry/registry-store.ts's `mintWithOutbox`, composition.ts's
 * `resumeStrandedCompositions`): see those files' header comments.
 */
import { randomUUID } from 'node:crypto';
import type { BusinessEventKey, DataContractEnvelope, Renderer } from '@busy-office/output-schema';
import type { DeliveryHistoryEvent, DocumentRegistryRow, DocumentState, RegistryStore } from '../registry/registry-store.js';
import type { ArchiveStore } from '../archive/archive-store.js';
import type { DeliveryQueue } from '../delivery/delivery-queue.js';
import type { SchemaValidationError } from '../problem.js';
import { defaultAuthorizationPort, extractPayslipOwnerId, type Actor, type AuthorizationPort } from '../authorization/authorization-port.js';
import {
  determine,
  type CallerDeterminationContext,
  type DeterminationContext,
  type DeterminationTrace,
  type Resolution,
} from '../determination/index.js';
import {
  resumeStrandedCompositions,
  selectRenderer,
  type CompositionDeps,
  type CompositionOutcome,
  type ResumeOutcome,
} from '../composition.js';
import { submitResolution } from '../submit-resolution.js';
import { createDocumentTypeRegistry, type DocumentTypeRegistry } from '../registration/document-type-registry.js';
import type { DocumentTypeDefinition, RegistrationResult } from '../registration/document-type-definition.js';

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
  /**
   * Composition backends. Supply ALL THREE for a port that renders,
   * archives, and enqueues delivery (what `serve()` and every host does).
   * Leave all three out for a determination-only port: `emit` still
   * validates, determines, and mints idempotent docIds against
   * `registryStore`, but composes nothing (no outbox row is written —
   * see submit-resolution.ts), `preview` reports `render-failed`, and
   * `resumeStrandedCompositions` finds nothing to do. This is the shape
   * a bare `createIngressServer()` (most unit tests) runs on.
   */
  archiveStore?: ArchiveStore;
  deliveryQueue?: DeliveryQueue;
  renderer?: Renderer;
  /** Renderer registry keyed by `Renderer.id` — see `CompositionDeps.renderers`. */
  renderers?: Readonly<Record<string, Renderer>>;
  /** Returns an RFC 3339 timestamp for a freshly-archived artifact's
   * mandatory retentionUntil, given the resolved `documentType`. Passed
   * straight through to `composeRenderArchiveAndEnqueue` — see
   * composition.ts for the per-document-type default. */
  retentionUntil?: (documentType: string) => string;
  /**
   * The document-type registry this port reads and `registerDocumentType`
   * writes. Defaults to a fresh, EMPTY registry — a port knows no document
   * type until something registers one. Pass the same instance that sits
   * on a `CompositionDeps.documentTypes` when the two must agree (what
   * `createRuntimeDeps` does).
   */
  documentTypes?: DocumentTypeRegistry;
  /** Document-level authorization (ROADMAP Stage 4). Typed on the deps
   * now so Stage 5's `reproduce` body can consult it without changing this
   * shape; the v1 stub never calls it. Defaults to `defaultAuthorizationPort`. */
  authorization?: AuthorizationPort;
}

// ---------------------------------------------------------------- emit

export interface EmitInput {
  /** The raw data-contract payload (the registered contract's shape) —
   * NOT wrapped in a CloudEvents envelope; that unwrapping is server.ts's
   * ingress-transport concern (a host embedding this module already has
   * its own event, in its own shape, by the time it calls `emit`). */
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

/** One resolution's outcome from `emit`. `composition` is `{ outcome:
 * 'replayed' }` when this resolution's docId already existed AND its
 * transactional-outbox work was already complete — the common, cheap replay
 * path. When a replay finds STRANDED outbox work (a prior crash), it is
 * redriven inline before returning, and `composition` carries the real
 * `CompositionOutcome` exactly as a first sighting would. Absent entirely
 * on a determination-only port (no composition backends supplied). */
export interface EmitResolutionResult {
  docId: string;
  replayed: boolean;
  ruleId: string;
  templateId: string;
  templateVersion: string;
  channel: string;
  recipients: string[];
  locale?: string;
  /** Which renderer the winning template declared (ADR-002 routing). */
  renderer?: string;
  composition?: CompositionOutcome | { outcome: 'replayed' };
}

export type EmitResult =
  | { status: 'unknown-document-type'; documentType: unknown }
  | { status: 'invalid-contract'; documentType: string; errors: SchemaValidationError[] }
  | { status: 'no-rule-match'; trace: DeterminationTrace }
  | { status: 'no-template-match'; trace: DeterminationTrace }
  | { status: 'unresolved-recipients'; trace: DeterminationTrace }
  | { status: 'accepted'; documentType: string; resolutions: EmitResolutionResult[]; trace: DeterminationTrace };

// ------------------------------------------------------------- preview

export interface PreviewInput {
  payload: unknown;
  documentType: unknown;
  /** REQUIRED: preview renders exactly the template you name. It never
   * runs determination — "which template would this event get?" is
   * `emit`'s question (and its trace answers it). */
  templateId: string;
  /** Passed to the renderer as a rendering hint only; no routing. */
  locale?: string;
}

export type PreviewResult =
  | { status: 'unknown-document-type'; documentType: unknown }
  | { status: 'invalid-contract'; documentType: string; errors: SchemaValidationError[] }
  /** No registered template with this id for this documentType (a meta
   * registered without content counts as unknown here too — there is
   * nothing to render). */
  | { status: 'unknown-template'; documentType: string; templateId: string }
  | { status: 'render-failed'; templateId: string; error: string }
  | { status: 'rendered'; templateId: string; bytes: Uint8Array; mediaType: string; renderer: string };

// -------------------------------------------------------------- status

/**
 * `status`'s read model: a PROJECTION of `DocumentRegistryRow` that
 * deliberately EXCLUDES `ownerId` (a natural person's identifier — PII;
 * the row keeps it for authorization, the status verb does not export it)
 * and internal pointers (`archiveRef`, hashes). `archived` collapses
 * "archiveRef set" into a boolean. `trace` is present on the primary
 * (first) resolution's row only — one persisted trace per event, filed
 * under that docId (server.ts's convention).
 */
export interface DocumentStatus {
  docId: string;
  ruleId: string;
  documentType: string;
  state: DocumentState;
  templateVersion: string;
  rendererVersion: string | null;
  archived: boolean;
  purgedAt: string | null;
  retentionUntil: string | null;
  locale: string | null;
  deliveryHistory: DeliveryHistoryEvent[];
  trace?: DeterminationTrace;
}

// ----------------------------------------------------------- reproduce

/** Typed now so Stage 5 fills in the body without changing callers. */
export interface ReproduceInput {
  docId: string;
  /** Who is asking — evaluated against the DOCUMENT (its registry row),
   * never the endpoint, once Stage 5 implements this. */
  actor: Actor;
}

export type ReproduceResult =
  /** The ONLY value v1 ever returns. No throw, no registry read, no
   * authorization call — the verb exists so the contract is complete. */
  | { status: 'not-implemented'; availableFrom: 'stage-5' }
  | { status: 'forbidden'; docId: string }
  | { status: 'unknown-document'; docId: string }
  | { status: 'reproduced'; docId: string; bytes: Uint8Array; mediaType: string };

// ---------------------------------------------------------------- port

export interface OutputPort {
  /**
   * Validate, determine, and (for every newly-minted or previously-stranded
   * resolution) compose+render+archive+enqueue one event. `serve()`'s
   * `POST /event` is a thin CloudEvents transport over this.
   */
  emit(input: EmitInput): Promise<EmitResult>;

  /**
   * Render one payload through one named template and hand back the
   * bytes. HLD §4: "Synchronous POST /render = preview: no archive, no
   * delivery, no registry." Also: no trace, no docId, no determination.
   */
  preview(input: PreviewInput): Promise<PreviewResult>;

  /**
   * What did this business event produce? One `DocumentStatus` per
   * registry row minted for `key` — fan-out means one per firing ruleId;
   * `[]` when the event was never accepted. Registry read only.
   */
  status(key: BusinessEventKey): Promise<DocumentStatus[]>;

  /**
   * reproduce = fetch archive (CLAUDE.md) — Stage 5. v1 returns
   * `{ status: 'not-implemented', availableFrom: 'stage-5' }` for every
   * input, touching neither the registry nor the authorization port.
   */
  reproduce(input: ReproduceInput): Promise<ReproduceResult>;

  /**
   * Register one document type (GAP-08): its contract (compiled here),
   * templates (meta + content), and rules. Synchronous, process-local,
   * in registration order, append-only — no unregister, no re-register,
   * no hot-reload. A duplicate `documentType` is `{ status: 'duplicate' }`;
   * any structural or compile problem is `{ status: 'invalid' }` and
   * registers nothing.
   */
  registerDocumentType(definition: DocumentTypeDefinition): RegistrationResult;

  /**
   * Redrive every composition_outbox row still pending past `minAgeMs`
   * (default 0) — see composition.ts's `resumeStrandedCompositions`. A host
   * embedding this module should call this once after process start (before
   * or after resuming normal traffic; `emit` also self-heals stranded
   * work it happens to encounter on a replay, so this is a sweep for
   * anything that never gets replayed) to close the crash-recovery loop.
   */
  resumeStrandedCompositions(minAgeMs?: number): Promise<ResumeOutcome[]>;
}

function toDocumentStatus(row: DocumentRegistryRow, trace: DeterminationTrace | undefined): DocumentStatus {
  return {
    docId: row.docId,
    ruleId: row.ruleId,
    documentType: row.documentType,
    state: row.state,
    templateVersion: row.templateVersion,
    rendererVersion: row.rendererVersion,
    archived: row.archiveRef !== null,
    purgedAt: row.purgedAt,
    retentionUntil: row.retentionUntil,
    locale: row.locale,
    deliveryHistory: row.deliveryHistory,
    ...(trace !== undefined ? { trace } : {}),
  };
}

/**
 * Assemble the embeddable Output API from caller-supplied ports. Building
 * nothing itself: no HTTP server, no hardcoded SQLite path, no filesystem
 * archive root, no document types — those are `serve()`'s /
 * `createRuntimeDeps`'s (index.ts) job for standalone runs. A host wanting
 * the same zero-external-services defaults can call `createRuntimeDeps()`
 * and use the `output` it already built, or pass its pieces through:
 *
 * ```ts
 * const deps = createRuntimeDeps(hostDbPath);
 * const output = createOutput({
 *   registryStore: deps.registryStore, archiveStore: deps.archiveStore,
 *   deliveryQueue: deps.deliveryQueue, renderer: deps.composition.renderer,
 *   documentTypes: deps.documentTypes,   // the built-ins, already registered
 * });
 * ```
 */
export function createOutput(deps: CreateOutputDeps): OutputPort {
  const documentTypes = deps.documentTypes ?? createDocumentTypeRegistry();
  // `authorization` is held for Stage 5's `reproduce`; v1 never calls it.
  const _authorization: AuthorizationPort = deps.authorization ?? defaultAuthorizationPort;
  void _authorization;

  const composition: CompositionDeps | undefined =
    deps.archiveStore !== undefined && deps.deliveryQueue !== undefined && deps.renderer !== undefined
      ? {
          registryStore: deps.registryStore,
          archiveStore: deps.archiveStore,
          deliveryQueue: deps.deliveryQueue,
          documentTypes,
          renderer: deps.renderer,
          ...(deps.renderers !== undefined ? { renderers: deps.renderers } : {}),
          ...(deps.retentionUntil !== undefined ? { retentionUntil: deps.retentionUntil } : {}),
        }
      : undefined;

  async function emitOneResolution(
    businessEvent: BusinessEventKey,
    resolution: Resolution,
    data: DataContractEnvelope,
    documentType: string,
  ): Promise<EmitResolutionResult> {
    // Transactional outbox mint -> compose -> clear-outbox lives in ONE
    // shared step (../submit-resolution.ts) — never re-implement it here.
    const outcome = await submitResolution(
      deps.registryStore,
      composition,
      businessEvent,
      resolution,
      data,
      documentType,
      extractPayslipOwnerId(documentType, data),
    );

    return {
      docId: outcome.docId,
      replayed: outcome.replayed,
      ruleId: resolution.ruleId,
      templateId: resolution.templateId,
      templateVersion: resolution.templateVersion,
      channel: resolution.channel,
      recipients: resolution.recipients,
      locale: resolution.locale,
      ...(resolution.renderer !== undefined ? { renderer: resolution.renderer } : {}),
      ...(outcome.composition !== undefined ? { composition: outcome.composition } : {}),
    };
  }

  return {
    async emit(input: EmitInput): Promise<EmitResult> {
      if (!documentTypes.has(input.documentType)) {
        return { status: 'unknown-document-type', documentType: input.documentType };
      }
      const documentType = input.documentType;

      const validation = documentTypes.validate(documentType, input.payload);
      if (!validation.valid) {
        return { status: 'invalid-contract', documentType, errors: validation.errors };
      }

      // Determination runs BEFORE any docId is minted: a no-match event
      // never produces a registry row for work that was never determined.
      const ctx: DeterminationContext = {
        documentType,
        businessObject: input.businessEvent.businessObject,
        event: input.businessEvent.event,
        ...sanitizeCallerDeterminationContext(input.determination),
      };
      const determination = determine(ctx, documentTypes.rules(), documentTypes.templateMetas());
      // Persist the TRACE on every outcome (HLD §9: the trace is
      // mandatory; the Rule trace console screen reads trace_log).
      // Non-match: a fresh id (no docId exists); matched: the PRIMARY
      // docId, after mint — `INSERT OR IGNORE` makes a replay a no-op.
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
          emitOneResolution(input.businessEvent, resolution, input.payload as DataContractEnvelope, documentType),
        ),
      );
      // One trace row per determine() CALL (per event), filed under the
      // PRIMARY (first) resolution's docId — see server.ts's response
      // convention, which mirrors this.
      const [primary] = resolutions;
      deps.registryStore.appendTraceLog(primary.docId, determination.trace);

      return { status: 'accepted', documentType, resolutions, trace: determination.trace };
    },

    async preview(input: PreviewInput): Promise<PreviewResult> {
      if (!documentTypes.has(input.documentType)) {
        return { status: 'unknown-document-type', documentType: input.documentType };
      }
      const documentType = input.documentType;

      const validation = documentTypes.validate(documentType, input.payload);
      if (!validation.valid) {
        return { status: 'invalid-contract', documentType, errors: validation.errors };
      }

      const meta = documentTypes.templateMeta(input.templateId);
      const docNode = documentTypes.templateContent(input.templateId);
      if (meta === undefined || docNode === undefined || meta.variant.documentType !== documentType) {
        return { status: 'unknown-template', documentType, templateId: input.templateId };
      }

      if (composition === undefined) {
        return { status: 'render-failed', templateId: input.templateId, error: 'no renderer configured on this OutputPort' };
      }
      try {
        // Same routing decision point composition uses (ADR-002): the
        // template's own `renderer` id, never a global default.
        const renderer = selectRenderer(composition, { templateId: meta.id, renderer: meta.renderer });
        const artifact = await renderer.render(
          { kind: 'ir', ir: { irVersion: '1', root: docNode, data: input.payload as DataContractEnvelope } },
          input.locale !== undefined ? { locale: input.locale } : undefined,
        );
        return {
          status: 'rendered',
          templateId: input.templateId,
          bytes: artifact.bytes,
          mediaType: artifact.mediaType,
          renderer: `${renderer.id}@${renderer.version}`,
        };
      } catch (err) {
        return {
          status: 'render-failed',
          templateId: input.templateId,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async status(key: BusinessEventKey): Promise<DocumentStatus[]> {
      const rows = deps.registryStore.listByEventKey(key);
      return rows.map((row) => toDocumentStatus(row, deps.registryStore.getTraceLog(row.docId)));
    },

    async reproduce(_input: ReproduceInput): Promise<ReproduceResult> {
      // Stage 5. Deliberately inert: no registry read, no authorization
      // call, no throw — the honest typed answer the ruling asked for.
      return { status: 'not-implemented', availableFrom: 'stage-5' };
    },

    registerDocumentType(definition: DocumentTypeDefinition): RegistrationResult {
      return documentTypes.register(definition);
    },

    async resumeStrandedCompositions(minAgeMs = 0): Promise<ResumeOutcome[]> {
      if (composition === undefined) return [];
      return resumeStrandedCompositions(composition, minAgeMs);
    },
  };
}
