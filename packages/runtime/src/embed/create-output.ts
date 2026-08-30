/**
 * `createOutput()` — the embeddable, topology-blind module API (ADR-007's
 * T1 "embedded module"), carrying **OutputPort v1.1** — the six-verb
 * consumer contract an arb-chair ruling fixed (docs/GAP-REGISTER.md;
 * ADR-007 addendum, Accepted) and later amended for the reprint verbs
 * (ADR-007 "Amendment — v1.1", also Accepted):
 *
 *   emit                   validate → determine → mint → compose → archive → enqueue
 *                          (+ optional `reissues` audit link: reissue IS emit with a new key)
 *   preview                render only — no registry row, archive, delivery, trace, or docId
 *   status                 registry read by BusinessEventKey → DocumentStatus[] (one per ruleId)
 *   reproduce              archive fetch — bytes only, original row untouched, reprint_log stamp
 *   regenerate             NEW DocumentInstance (state REPRINT) from CALLER-SUPPLIED data
 *                          against the current published template, reprint_log stamp
 *   peekArchive            same authorization check as reproduce, archive fetch — but a
 *                          PASSIVE read: no reason, no reprint_log stamp. For a caller
 *                          that is merely displaying archived bytes, not performing a
 *                          reprint action.
 *   registerDocumentType   synchronous, process-local, in-order, no unregister
 *   resumeStrandedCompositions   operational — unchanged
 *
 * Reprint trichotomy (CLAUDE.md / docs/POLICY.md — unchanged): reproduce =
 * fetch archive; regenerate = current template + data; reissue = new
 * event. Delivery failure never re-renders and no verb here re-renders
 * "the old document": regenerate is a NEW document, because the registry
 * holds no payload by design (HLD §1). All three are authorized against
 * the DOCUMENT (its registry row) via `AuthorizationPort.canAccess` — this
 * module is that port's first real caller. The "state stamp" is METADATA:
 * an append-only `reprint_log` row (migration 0013), never a byte of the
 * archived artifact (immutable once archived) and never a watermark
 * (closed by the frozen expression grammar — see docs/GAP-REGISTER.md
 * for the open question on a visible one).
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
 * The port knows NO document type of its own: contracts,
 * templates, and rules arrive through `registerDocumentType` and live in
 * the `DocumentTypeRegistry` this port reads. The composition root
 * registers the built-ins; a host registers its own. Nothing here scans a
 * directory or imports a document type.
 *
 * `emit` reuses `determine()` (determination/) and the shared
 * per-resolution mint -> compose -> clear-outbox step (submit-resolution.ts)
 * verbatim — this module does not reimplement rule evaluation,
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
import {
  createDefaultAuthorizationPort,
  extractOwnerId,
  type Actor,
  type AuthorizationPort,
  type ReprintAction,
} from '../authorization/authorization-port.js';
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
import { createTemplateLifecycle } from '../lifecycle/template-lifecycle.js';
import { hasSubjectId } from '../lifecycle/transitions.js';

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
  /** Document-level authorization. Consulted by
   * `reproduce`, `regenerate`, and `emit`'s `reissues` link — always
   * against the ORIGINAL document's registry row, before any
   * other work. Defaults to `createDefaultAuthorizationPort` over this
   * port's document-type registry. */
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
   * ruling) that a rule may override; shape-validated
   * here exactly as on the HTTP path (array of non-empty strings) and
   * nothing more. */
  determination?: CallerDeterminationContext;
  /**
   * reissue = a NEW business event (CLAUDE.md), so reissue has NO verb of
   * its own — it IS this `emit` with a new `businessEvent`. This field adds
   * ONLY the audit link back to the document being reissued: the original
   * row is fetched and authorized (`canAccess(actor, row, 'reissue')`)
   * BEFORE the normal emit runs, and every docId this emit freshly mints
   * gets a `reprint_log { action: 'reissue', resultDocId }` row stamped
   * against `docId`. The original row itself is untouched.
   */
  reissues?: ReprintAuditInput;
}

/** The "who / which / why" every reprint verb requires (ADR-007 v1.1):
 * `actor.subjectId` must be present (`actor-required`) and `reason`
 * non-blank (`reason-required`) — an audit row with no who or why is not
 * an audit row. */
export interface ReprintAuditInput {
  docId: string;
  /** Evaluated against the DOCUMENT (its registry row), never the endpoint. */
  actor: Actor;
  reason: string;
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
  /** The message template (email subject/body) this resolution's
   * channel resolved, by ID — never the rendered text. */
  messageTemplateId?: string;
  composition?: CompositionOutcome | { outcome: 'replayed' };
}

/** The refusals shared by every reprint path (reproduce / regenerate /
 * emit-with-`reissues`), all keyed by the ORIGINAL docId. Order of
 * evaluation: unknown-document (no row to authorize against) → forbidden
 * (authz, before any other work) → actor-required → reason-required. */
export type ReprintRefusal = { status: 'forbidden' | 'unknown-document' | 'actor-required' | 'reason-required'; docId: string };

export type EmitResult =
  /** Only when `EmitInput.reissues` is present — refusals about the
   * document being reissued, raised before the normal emit path runs. */
  | ReprintRefusal
  | { status: 'unknown-document-type'; documentType: unknown }
  | { status: 'invalid-contract'; documentType: string; errors: SchemaValidationError[] }
  | { status: 'no-rule-match'; trace: DeterminationTrace }
  | { status: 'no-template-match'; trace: DeterminationTrace }
  | { status: 'unresolved-recipients'; trace: DeterminationTrace }
  | { status: 'unresolved-message-template'; trace: DeterminationTrace }
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

/** reproduce = fetch archive. Bytes ONLY — no delivery (there is
 * no `channel` here by design). */
export type ReproduceInput = ReprintAuditInput;

export type ReproduceResult =
  | ReprintRefusal
  /** `archiveRef` null and never purged: a DRAFT / stranded row that has
   * no archived artifact to fetch. */
  | { status: 'not-archived'; docId: string }
  /** Retention enforcement purged the bytes — the row (and its
   * `retentionUntil`) remain as history; there is nothing to reproduce. */
  | { status: 'purged'; docId: string; purgedAt: string }
  | {
      status: 'reproduced';
      docId: string;
      /** BYTE-IDENTICAL to what was archived. Never modified, never stamped. */
      bytes: Uint8Array;
      /** Present only when the archive store could read it back
       * (`ArchiveStore.retrieveMediaType`); never assumed. */
      mediaType?: string;
      /** The id of the `reprint_log` row this fetch stamped — the metadata
       * stamp, in lieu of any change to the bytes or the original row. */
      reprintLogId: number;
    };

// ---------------------------------------------------------- peekArchive

/** peekArchive = the same document-level authorization check `reproduce`
 * uses, then an archive fetch — but PASSIVE: no reason is required and no
 * `reprint_log` row is stamped. For a caller displaying archived bytes
 * (an inline preview), not performing a reprint action. */
export interface PeekInput {
  docId: string;
  actor: Actor;
}

export type PeekResult =
  | { status: 'unknown-document'; docId: string }
  | { status: 'forbidden'; docId: string }
  /** `archiveRef` null and never purged: a DRAFT / stranded row that has
   * no archived artifact to fetch. */
  | { status: 'not-archived'; docId: string }
  /** Retention enforcement purged the bytes — the row (and its
   * `retentionUntil`) remain as history; there is nothing to fetch. */
  | { status: 'purged'; docId: string; purgedAt: string }
  | {
      status: 'available';
      docId: string;
      /** BYTE-IDENTICAL to what was archived. Never modified. */
      bytes: Uint8Array;
      /** Present only when the archive store could read it back
       * (`ArchiveStore.retrieveMediaType`); never assumed. */
      mediaType?: string;
    };

// ---------------------------------------------------------- regenerate

/**
 * regenerate = current template + data: a NEW DocumentInstance (state
 * REPRINT) rendered from CALLER-SUPPLIED `payload` against whatever the
 * ORIGINAL row's rule resolves to under the CURRENT published templates.
 * The registry holds no payload by design (HLD §1), so a real ERP re-emits
 * its data here; nothing ever "re-renders the old document" (POLICY.md).
 */
export interface RegenerateInput extends ReprintAuditInput {
  payload: unknown;
  /** Same routing hints as `EmitInput.determination` — the ORIGINAL row
   * supplies documentType / businessObject / event; the caller supplies
   * the rest (locale, country, recipients, ...) exactly as it would on
   * `emit`. */
  determination?: CallerDeterminationContext;
}

export type RegenerateResult =
  | ReprintRefusal
  | { status: 'invalid-contract'; documentType: string; errors: SchemaValidationError[] }
  /** The original row's `ruleId` no longer fires for this context (rule
   * retired, template unpublished, ...) — the trace says why. */
  | { status: 'no-rule-match'; trace: DeterminationTrace }
  | { status: 'no-template-match'; trace: DeterminationTrace }
  | { status: 'unresolved-recipients'; trace: DeterminationTrace }
  | { status: 'unresolved-message-template'; trace: DeterminationTrace }
  | {
      status: 'regenerated';
      originalDocId: string;
      /** The NEW row. Non-idempotent by definition: a second regenerate
       * of the same original mints a third row. */
      docId: string;
      state: 'REPRINT';
      /** Absent on a determination-only port (no composition backends). */
      composition?: CompositionOutcome;
      trace: DeterminationTrace;
    };

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
   * reproduce = fetch archive (CLAUDE.md). Authorizes against the row
   * FIRST (`forbidden` before the archive is touched), requires an actor
   * subjectId and a reason, then returns the archived bytes BYTE-IDENTICAL
   * and stamps one `reprint_log` row. The original row is untouched (state
   * stays ORIGINAL, updatedAt unchanged). No delivery.
   */
  reproduce(input: ReproduceInput): Promise<ReproduceResult>;

  /**
   * regenerate = current template + data (CLAUDE.md): authorize → validate
   * the caller's payload → determine with the ORIGINAL row's
   * documentType/businessObject/event against the CURRENT published
   * templates → keep only the original's `ruleId` → mint a NEW row under a
   * distinguished key → compose/render/archive/enqueue it → state REPRINT →
   * stamp `reprint_log { action: 'regenerate', resultDocId }`. The
   * original row and its bytes are untouched.
   */
  regenerate(input: RegenerateInput): Promise<RegenerateResult>;

  /**
   * peekArchive = a passive archive read: the same
   * `AuthorizationPort.canAccess(actor, row, 'reproduce')` check `reproduce`
   * uses, then the archived bytes BYTE-IDENTICAL — but no reason is
   * required and NOTHING is appended to `reprint_log`. For a caller
   * displaying archived bytes (an inline preview) rather than performing a
   * reprint action; never call this where a `reprint_log` row is expected.
   */
  peekArchive(input: PeekInput): Promise<PeekResult>;

  /**
   * Register one document type: its contract (compiled here),
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
  const authorization: AuthorizationPort = deps.authorization ?? createDefaultAuthorizationPort(documentTypes);
  // Template lifecycle state lives in the registry store's
  // append-only log, NOT in the DocumentTypeRegistry (whose maps are
  // declaration only and are never mutated by a transition). Seeded on
  // registration, overlaid on emit's candidates, absent from preview.
  const lifecycle = createTemplateLifecycle(deps.registryStore);

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
      // The owner is wherever the type's OWNER said it is (registry).
      extractOwnerId(documentTypes.ownerIdPath(documentType), data),
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
      ...(resolution.messageTemplateId !== undefined ? { messageTemplateId: resolution.messageTemplateId } : {}),
      ...(outcome.composition !== undefined ? { composition: outcome.composition } : {}),
    };
  }

  /**
   * The shared front door of every reprint path: fetch the ORIGINAL row,
   * authorize the actor against IT (CLAUDE.md: the document, not the
   * endpoint) before anything else is read or written, then require the
   * audit fields. Returns the row on success; a `ReprintRefusal` otherwise.
   * Reuses task 1's `hasSubjectId` — one definition of "has an actor".
   */
  function admitReprint(
    input: ReprintAuditInput,
    action: ReprintAction,
  ): { ok: true; row: DocumentRegistryRow; actor: Actor & { subjectId: string } } | { ok: false; refusal: ReprintRefusal } {
    const row = deps.registryStore.getByDocId(input.docId);
    if (row === undefined) return { ok: false, refusal: { status: 'unknown-document', docId: input.docId } };
    if (!authorization.canAccess(input.actor, row, action)) {
      return { ok: false, refusal: { status: 'forbidden', docId: input.docId } };
    }
    if (!hasSubjectId(input.actor)) return { ok: false, refusal: { status: 'actor-required', docId: input.docId } };
    if (typeof input.reason !== 'string' || input.reason.trim() === '') {
      return { ok: false, refusal: { status: 'reason-required', docId: input.docId } };
    }
    return { ok: true, row, actor: input.actor };
  }

  function stampReprint(
    row: DocumentRegistryRow,
    action: ReprintAction,
    actor: Actor & { subjectId: string },
    reason: string,
    resultDocId: string | null,
  ): number {
    return deps.registryStore.appendReprintLog({
      docId: row.docId,
      action,
      resultDocId,
      actorRole: actor.role,
      actorSubjectId: actor.subjectId,
      reason,
      occurredAt: new Date().toISOString(),
    });
  }

  return {
    async emit(input: EmitInput): Promise<EmitResult> {
      // reissue = emit + audit link: the ORIGINAL document is fetched and
      // authorized BEFORE the new event is processed at all, so a
      // forbidden reissue mints nothing.
      let reissue: { row: DocumentRegistryRow; actor: Actor & { subjectId: string }; reason: string } | undefined;
      if (input.reissues !== undefined) {
        const admitted = admitReprint(input.reissues, 'reissue');
        if (!admitted.ok) return admitted.refusal;
        reissue = { row: admitted.row, actor: admitted.actor, reason: input.reissues.reason };
      }

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
      // Candidates carry their CURRENT persisted lifecycle:
      // determine() admits only `published` ones and traces the rest.
      const determination = determine(
        ctx,
        documentTypes.rules(),
        lifecycle.liveState(documentTypes.templateMetas()),
        lifecycle.liveState(documentTypes.messageTemplateMetas()),
      );
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
      if (determination.outcome === 'unresolved-message-template') {
        // Nothing minted, nothing enqueued — an email with no
        // governed subject/body is a determination failure, not a
        // bare-attachment send.
        deps.registryStore.appendTraceLog(randomUUID(), determination.trace);
        return { status: 'unresolved-message-template', trace: determination.trace };
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

      if (reissue !== undefined) {
        // One audit row per docId this emit FRESHLY minted. A replay of the
        // reissue event (same new key) minted nothing, so it stamps
        // nothing — the audit link is written once, like the row it links.
        for (const resolution of resolutions) {
          if (resolution.replayed) continue;
          stampReprint(reissue.row, 'reissue', reissue.actor, reissue.reason, resolution.docId);
        }
      }

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

    async reproduce(input: ReproduceInput): Promise<ReproduceResult> {
      const admitted = admitReprint(input, 'reproduce');
      if (!admitted.ok) return admitted.refusal;
      const { row, actor } = admitted;

      if (row.archiveRef === null) {
        // `markPurged` clears archiveRef and sets purgedAt together; a
        // null archiveRef with NO purgedAt is a row that was never
        // archived (DRAFT, or stranded mid-composition).
        if (row.purgedAt !== null) return { status: 'purged', docId: row.docId, purgedAt: row.purgedAt };
        return { status: 'not-archived', docId: row.docId };
      }
      if (deps.archiveStore === undefined) {
        // A wiring bug, not a runtime condition: the row says its bytes are
        // archived, and this port was built with nowhere to read them from.
        throw new Error('OutputPort.reproduce requires an archiveStore on this port; none was supplied.');
      }

      // The archive is the reproduction (CLAUDE.md): bytes exactly as
      // archived. The stamp is the reprint_log row below — never the bytes,
      // never the original registry row.
      const bytes = await deps.archiveStore.retrieve(row.archiveRef);
      const mediaType = await deps.archiveStore.retrieveMediaType?.(row.archiveRef);
      const reprintLogId = stampReprint(row, 'reproduce', actor, input.reason, null);

      return {
        status: 'reproduced',
        docId: row.docId,
        bytes,
        ...(mediaType !== undefined ? { mediaType } : {}),
        reprintLogId,
      };
    },

    async peekArchive(input: PeekInput): Promise<PeekResult> {
      const row = deps.registryStore.getByDocId(input.docId);
      if (row === undefined) return { status: 'unknown-document', docId: input.docId };
      // Same document-level check `reproduce` uses — but this is where the
      // similarity ends: no `hasSubjectId`/reason requirement, no
      // `stampReprint`. A passive view is not a reprint action.
      if (!authorization.canAccess(input.actor, row, 'reproduce')) {
        return { status: 'forbidden', docId: input.docId };
      }

      if (row.archiveRef === null) {
        if (row.purgedAt !== null) return { status: 'purged', docId: row.docId, purgedAt: row.purgedAt };
        return { status: 'not-archived', docId: row.docId };
      }
      if (deps.archiveStore === undefined) {
        throw new Error('OutputPort.peekArchive requires an archiveStore on this port; none was supplied.');
      }

      const bytes = await deps.archiveStore.retrieve(row.archiveRef);
      const mediaType = await deps.archiveStore.retrieveMediaType?.(row.archiveRef);

      return {
        status: 'available',
        docId: row.docId,
        bytes,
        ...(mediaType !== undefined ? { mediaType } : {}),
      };
    },

    async regenerate(input: RegenerateInput): Promise<RegenerateResult> {
      const admitted = admitReprint(input, 'regenerate');
      if (!admitted.ok) return admitted.refusal;
      const { row, actor } = admitted;
      const documentType = row.documentType;

      const validation = documentTypes.validate(documentType, input.payload);
      if (!validation.valid) {
        return { status: 'invalid-contract', documentType, errors: validation.errors };
      }

      // Determine EXACTLY as emit does — same rules, same current published
      // candidates (task 1's liveState) — for the ORIGINAL row's identity
      // plus whatever routing context the caller supplies now.
      const ctx: DeterminationContext = {
        documentType,
        businessObject: row.businessObject,
        event: row.event,
        ...sanitizeCallerDeterminationContext(input.determination),
      };
      const determination = determine(
        ctx,
        documentTypes.rules(),
        lifecycle.liveState(documentTypes.templateMetas()),
        lifecycle.liveState(documentTypes.messageTemplateMetas()),
      );
      if (determination.outcome !== 'matched') {
        deps.registryStore.appendTraceLog(randomUUID(), determination.trace);
        return { status: determination.outcome, trace: determination.trace };
      }
      // Only the resolution the ORIGINAL row came from is regenerated — a
      // fan-out sibling is a different document. If that rule no longer
      // fires here, that is a no-rule-match WITH the trace saying why.
      const resolution = determination.resolutions.find((r) => r.ruleId === row.ruleId);
      if (resolution === undefined) {
        deps.registryStore.appendTraceLog(randomUUID(), determination.trace);
        return { status: 'no-rule-match', trace: determination.trace };
      }

      // Distinguished mint key (arb-chair ruling): the new row shares the
      // original's four-tuple, so the fifth column (rule_id) carries
      // `regenerate:<originalDocId>:<nonce>` instead of the rule id — the
      // five-tuple UNIQUE index (migration 0003) cannot collapse it onto the
      // original, and (nonce) a SECOND regenerate mints a THIRD row rather
      // than replaying the second. No `supersedes` column: the
      // original -> reprint link is the reprint_log row stamped below (and
      // is also readable off this prefix). The ruling named
      // `<reprintLogId>` as the suffix; reprint_log is append-only and its
      // row must carry the NEW docId, which does not exist until this
      // mint — so a fresh UUID stands in as the distinguishing suffix.
      const mintKey = `regenerate:${row.docId}:${randomUUID()}`;
      const businessEvent: BusinessEventKey = {
        businessObject: row.businessObject,
        businessObjectId: row.businessObjectId,
        event: row.event,
        templateVersion: resolution.templateVersion,
      };
      const data = input.payload as DataContractEnvelope;
      // Same transactional mint -> compose -> clear-outbox step as emit
      // (submit-resolution.ts): crash-safe, and the reprint gets its OWN
      // archiveRef / rendererVersion / retentionUntil / delivery job.
      const outcome = await submitResolution(
        deps.registryStore,
        composition,
        businessEvent,
        { ...resolution, ruleId: mintKey },
        data,
        documentType,
        extractOwnerId(documentTypes.ownerIdPath(documentType), data),
      );
      // The new row is a REPRINT by identity — what it IS, not whether its
      // render succeeded (a failed composition leaves archiveRef null, and
      // reproduce reports that honestly as `not-archived`).
      deps.registryStore.updateState(outcome.docId, 'REPRINT');
      deps.registryStore.appendTraceLog(outcome.docId, determination.trace);
      stampReprint(row, 'regenerate', actor, input.reason, outcome.docId);

      const composed = outcome.composition;
      return {
        status: 'regenerated',
        originalDocId: row.docId,
        docId: outcome.docId,
        state: 'REPRINT',
        ...(composed !== undefined && composed.outcome !== 'replayed' ? { composition: composed } : {}),
        trace: determination.trace,
      };
    },

    registerDocumentType(definition: DocumentTypeDefinition): RegistrationResult {
      const result = documentTypes.register(definition);
      if (result.status === 'registered') {
        // Seed the lifecycle log with each template's DECLARED state
        // (document AND message templates) — only for keys with no
        // history; an existing row wins and the declaration is ignored.
        lifecycle.seedFromRegistration(definition.documentType, [
          ...definition.templates.map((t) => t.meta),
          ...(definition.messageTemplates ?? []).map((t) => t.meta),
        ]);
      }
      return result;
    },

    async resumeStrandedCompositions(minAgeMs = 0): Promise<ResumeOutcome[]> {
      if (composition === undefined) return [];
      return resumeStrandedCompositions(composition, minAgeMs);
    },
  };
}
