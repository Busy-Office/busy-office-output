/**
 * RegistryStore port (ROADMAP Stage 3, HLD §3 "Data model (registry-centric)":
 * DocumentInstance + DeliveryAttempt). One row per artifact, forever
 * (CLAUDE.md golden rule) — this is the durable replacement for the
 * original in-memory idempotency Map (its `IdempotencyStore` facade was
 * deleted under GAP-16; submit-resolution.ts calls this port directly), and
 * the seam later Stage 3 tasks (archive store, delivery queue) attach to
 * without this file changing.
 *
 * Deliberately minimal for THIS task's DoD — no more than what idempotency
 * replay + a registry row + state + delivery history need:
 *   - getOrCreateByEventKey: the idempotency lookup — mints docId on first
 *     sighting, returns the same row on replay.
 *   - getByDocId: read a row back by its primary key.
 *   - updateState: transition ORIGINAL/COPY/DUPLICATE/REPRINT/CANCELLED/DRAFT.
 *   - appendDeliveryEvent: append one append-only delivery-history record.
 *   - updateArchiveRef: record where the archived bytes live and the
 *     mandatory retentionUntil deadline for them (added for the Archive
 *     store task — see src/archive/archive-store.ts).
 * Extended for ROADMAP Stage 3 "Minimal console, read-only"
 * (migrations/0006_add_document_type.sql, 0007_add_trace_log.sql):
 *   - every mint method (getOrCreateByEventKey / getOrCreateByResolutionKey
 *     / mintWithOutbox) takes an optional `documentType`, persisted on the
 *     row for the Registry screen's payslip-lock gating.
 *   - appendTraceLog / getTraceLog: a minimal, separate append-only log of
 *     persisted DeterminationTrace rows, for the Rule trace screen.
 *   - listDocuments: the Registry screen's read model — most-recent-first,
 *     with server-side search + limit/offset (no other pagination chrome
 *     per docs/UI-DESIGN.md).
 * Explicitly NOT here: archiving bytes (that's ArchiveStore's job — this
 * port only records the resulting pointer), retention *enforcement*
 * (Stage 4), actually delivering anything — those are separate, later
 * ROADMAP tasks and must not be speculatively added to this port.
 *
 * Backend-agnostic on purpose: this interface has no SQLite (or Postgres)
 * in its signatures. `SqliteRegistryStore` (sqlite-registry-store.ts) is the
 * only implementation right now — a Postgres implementation is explicitly
 * out of scope, gated on ADR-004 ("if the registry lands on Postgres
 * anyway"). Nothing here should make that later implementation awkward.
 */
import type { BusinessEventKey, TemplateLifecycle } from '@busy-office/output-schema';
import type { DeterminationTrace } from '../determination/trace.js';

/**
 * One append-only row of the template lifecycle log (ROADMAP Stage 5 task
 * 1; migrations/0012_add_template_lifecycle.sql). The current state of a
 * `templateId@version` is its LATEST row — there is no separate "current"
 * table. `fromState` is `null` on the seed row registration writes. Audit
 * fields only: never template content, never a payload.
 */
export interface TemplateLifecycleEvent {
  templateId: string;
  version: string;
  fromState: TemplateLifecycle | null;
  toState: TemplateLifecycle;
  actorRole: string;
  actorSubjectId: string;
  reason: string;
  /** RFC 3339. */
  occurredAt: string;
}

/** The three reprint actions (Stage 5 task 2) — the same trichotomy
 * `authorization/authorization-port.ts`'s `ReprintAction` names; repeated
 * here as a string literal union so this port stays import-free of the
 * authorization module. */
export type ReprintLogAction = 'reproduce' | 'regenerate' | 'reissue';

/**
 * One append-only row of the reprint log (ROADMAP Stage 5 task 2;
 * migrations/0013_add_reprint_log.sql) — the METADATA stamp that records a
 * reproduce / regenerate / reissue against `docId`. `resultDocId` is
 * `null` for `reproduce` (nothing minted) and the NEW row's docId for
 * `regenerate` / `reissue`. Audit fields only: never payload, bytes, or
 * recipients.
 */
export interface ReprintLogEvent {
  docId: string;
  action: ReprintLogAction;
  resultDocId: string | null;
  actorRole: string;
  actorSubjectId: string;
  reason: string;
  /** RFC 3339. */
  occurredAt: string;
}

/** A persisted `ReprintLogEvent` with its autoincrement id. */
export interface ReprintLogEntry extends ReprintLogEvent {
  id: number;
}

/**
 * The idempotency key for ONE resolution (ROADMAP Stage 3 "Fan-out: one
 * event → N resolutions" task). `BusinessEventKey`'s four-tuple
 * (businessObject, businessObjectId, event, templateVersion) was built
 * assuming one event → one docId; with fan-out, one event can now produce
 * several resolutions that legitimately share ALL FOUR of those fields at
 * once (e.g. two fan-out rules routing the same invoice to two different
 * object-store archives, both resolving to the same template version). The
 * four-tuple alone can no longer tell those apart, so `ruleId` — the
 * firing `OutputRule.id` that produced this particular resolution — is
 * added as a fifth, disambiguating key field. Deliberately NOT added to
 * `BusinessEventKey` itself (packages/schema, a shared, widely-used
 * contract type its own package keeps zero-runtime-dependency and stable):
 * this is a determination-layer concept the registry lookup needs, not a
 * change to the wire-level business-event identity every existing caller
 * already depends on.
 *
 * Replay stability: the SAME event + SAME ruleId must always resolve to
 * the SAME docId (never mint a duplicate) — that is what the unique index
 * in migrations/0003_add_rule_id_to_registry.sql enforces at the DB layer,
 * mirroring the four-tuple's own enforcement in 0001_init.sql.
 */
export interface ResolutionEventKey extends BusinessEventKey {
  ruleId: string;
}

/**
 * HLD §3: "state ORIGINAL/COPY/DUPLICATE/REPRINT/CANCELLED/DRAFT".
 * New rows start DRAFT — see migrations/0001_init.sql for why.
 */
export type DocumentState = 'DRAFT' | 'ORIGINAL' | 'COPY' | 'DUPLICATE' | 'REPRINT' | 'CANCELLED';

/**
 * One append-only delivery-history record (HLD §3: "DeliveryAttempt
 * (append-only)"). `status` is a free-form string owned by the future
 * Delivery queue task (e.g. "attempted" | "delivered" | "failed" |
 * "poisoned") — the registry does not interpret it, only records it.
 */
export interface DeliveryHistoryEvent {
  channel: string;
  status: string;
  occurredAt: string; // ISO 8601
  detail?: string;
}

/** One row per artifact, per HLD §3's DocumentInstance. */
export interface DocumentRegistryRow {
  docId: string;
  businessObject: string;
  businessObjectId: string;
  event: string;
  templateVersion: string;
  rendererVersion: string | null;
  inputHash: string | null;
  outputHash: string | null;
  /** Pointer into the archive store (src/archive/). Null until archived. */
  archiveRef: string | null;
  /** RFC 3339 timestamp: mandatory once archived, null until then. See
   * migrations/0002_add_retention_until.sql. Left untouched by a purge —
   * it stays the historical deadline that was in force, even after the
   * bytes are gone. */
  retentionUntil: string | null;
  /** RFC 3339 timestamp the archived bytes were purged at (ROADMAP Stage 4
   * retention enforcement), or null if this artifact has never been
   * purged — including rows never archived at all. See
   * migrations/0008_add_purged_at.sql and `markPurged` below for why this
   * is a separate column rather than a new `state` value or a silently
   * blanked `archiveRef`. */
  purgedAt: string | null;
  /**
   * The firing `OutputRule.id` that produced this resolution (see
   * `ResolutionEventKey` above). `''` for rows minted via the plain
   * four-tuple `getOrCreateByEventKey` (pre-fan-out callers, and any
   * caller that genuinely has no rule to disambiguate by) — never `null`,
   * so it composes cleanly with the unique index's NOT NULL column.
   */
  ruleId: string;
  /**
   * The documentType this artifact was determined for (e.g.
   * "purchase-order", "payslip"). `''` for rows minted before
   * migrations/0006_add_document_type.sql, or via any caller that omits
   * the optional `documentType` argument to a mint method — never `null`,
   * same NOT-NULL-DEFAULT-'' reasoning as `ruleId` above. The Registry
   * console screen gates its lock glyph on whether the registered type is
   * owner-scoped (supplies an `ownerIdPath`, GAP-17) — never on the name.
   */
  documentType: string;
  /**
   * The natural-person owner of this artifact (ROADMAP Stage 4,
   * "Document-level authorization"), or `null` when this document type has
   * no natural-person owner (e.g. purchase-order, invoice) or the row was
   * minted before migrations/0009_add_owner_id.sql. Populated ONLY for
   * payslip mints, from the payslip data contract's `header.employeeId` —
   * see `authorization/authorization-port.ts`'s default `AuthorizationPort`
   * implementation, which compares an `employee` actor's `subjectId`
   * against this field. Unlike `ruleId`/`documentType`, deliberately
   * nullable rather than NOT-NULL-DEFAULT-'' — see the migration's own
   * comment for why. Never logged (same PII discipline as the payslip
   * payload itself — src/embed/payslip-log-scrub.test.ts).
   */
  ownerId: string | null;
  /**
   * The locale this resolution was determined with (`Resolution.locale`:
   * the firing rule's override, else the caller's determination context),
   * persisted at mint (migrations/0010_add_locale.sql — Stage 4 exit gate
   * clause 2's row-level evidence). `null` when neither supplied one, or
   * for rows minted before that migration. Locale-aware FORMATTING is a
   * Stage 6 concern; this column records routing, not rendering.
   */
  locale: string | null;
  state: DocumentState;
  createdAt: string;
  updatedAt: string;
  deliveryHistory: DeliveryHistoryEvent[];
}

/** `RegistryStore.listDocuments`'s query shape — the Registry console
 * screen's one search box plus its "load more" link, nothing else
 * (docs/UI-DESIGN.md: no sortable columns/filter dropdowns beside the one
 * search box, no pagination widget beyond an optional simple "load more"
 * link). */
export interface ListDocumentsQuery {
  /** Case-insensitive substring match over docId / businessObjectId /
   * event / templateVersion. Empty or omitted: no filter. */
  search?: string;
  /** Max rows to return. Defaults to a store-chosen page size. */
  limit?: number;
  /** Rows to skip, most-recent-first — what "load more" advances. */
  offset?: number;
}

export interface GetOrCreateResult {
  row: DocumentRegistryRow;
  /** false when this four-tuple already had a row (idempotent replay). */
  created: boolean;
}

/**
 * One pending transactional-outbox row (see migrations/0005_add_composition_
 * outbox.sql for the full rationale). `resolution`/`data` are exactly what
 * `composeRenderArchiveAndEnqueue` needs to redo its work for `docId` —
 * JSON-parsed already, so callers can cast straight to `Resolution` /
 * `DataContractEnvelope` without re-parsing.
 */
export interface OutboxEntry {
  docId: string;
  resolution: unknown;
  data: unknown;
  createdAt: string;
}

export interface RegistryStore {
  /**
   * The idempotency lookup (HLD §4): first sighting of `key` mints a new
   * docId and inserts a DRAFT row, returning { created: true }. Any later
   * call with an equal four-tuple returns the SAME row, unchanged, with
   * { created: false } — no new work, no new row.
   *
   * `documentType` (optional, default `''`) is persisted on a newly minted
   * row only — ignored on replay, since the row (and its documentType)
   * already exists. See `DocumentRegistryRow.documentType`.
   *
   * `ownerId` (optional, default `undefined` -> stored as `null`): see
   * `DocumentRegistryRow.ownerId`. Same "newly minted row only" rule as
   * `documentType`.
   *
   * `locale` (optional, default `undefined` -> stored as `null`): see
   * `DocumentRegistryRow.locale`. Same "newly minted row only" rule.
   */
  getOrCreateByEventKey(key: BusinessEventKey, documentType?: string, ownerId?: string, locale?: string): GetOrCreateResult;

  /**
   * The fan-out-aware idempotency lookup (see `ResolutionEventKey` above):
   * first sighting of the five-tuple (four-tuple + ruleId) mints a new
   * docId and inserts a DRAFT row; any later call with an equal five-tuple
   * returns the SAME row, unchanged. `getOrCreateByEventKey` is exactly
   * this method called with `ruleId: ''` — the two share one
   * implementation and one unique index, so a plain four-tuple lookup and
   * a ruleId-disambiguated lookup can never disagree about identity.
   *
   * `documentType` (optional, default `''`): see `getOrCreateByEventKey`.
   * `ownerId` / `locale` (optional): see `getOrCreateByEventKey`.
   */
  getOrCreateByResolutionKey(key: ResolutionEventKey, documentType?: string, ownerId?: string, locale?: string): GetOrCreateResult;

  /**
   * The transactional-outbox-aware mint (ROADMAP Stage 3 "Embeddable
   * module ... transactional outbox"): identical mint-or-fetch contract to
   * `getOrCreateByResolutionKey`, except on first sighting (`created:
   * true`) it ALSO writes a `composition_outbox` row for the new docId, in
   * the SAME SQLite transaction as the `document_registry` insert — either
   * both rows exist or neither does, closing the window where a docId is
   * minted with no durable record of the composition work still owed on
   * it. On replay (`created: false`) the outbox is left untouched — call
   * `getOutboxEntry(row.docId)` to find out whether a previous attempt's
   * composition work is still pending (stranded by a crash) and needs
   * redriving before treating this as a pure replay.
   *
   * `ownerId` / `locale` (optional): see `getOrCreateByEventKey`.
   */
  mintWithOutbox(
    key: ResolutionEventKey,
    resolution: unknown,
    data: unknown,
    documentType?: string,
    ownerId?: string,
    locale?: string,
  ): GetOrCreateResult;

  /** The pending outbox entry for `docId`, or undefined if none exists
   * (composition already completed for it, or it was never minted via
   * `mintWithOutbox`). */
  getOutboxEntry(docId: string): OutboxEntry | undefined;

  /** Every outbox entry still pending, oldest first — the source of truth
   * `resumeStrandedCompositions` (composition.ts) scans. */
  listOutboxEntries(): OutboxEntry[];

  /** Delete the outbox entry for `docId`, if any. Called once
   * `composeRenderArchiveAndEnqueue` has run to completion for it (any
   * outcome). Safe to call even when no entry exists (idempotent). */
  clearOutboxEntry(docId: string): void;

  /** Fetch a row by its docId. Returns undefined if no such row exists. */
  getByDocId(docId: string): DocumentRegistryRow | undefined;

  /**
   * Transition `state` in place (updatedAt is bumped). Throws if `docId`
   * does not exist — callers must not silently no-op against an unknown
   * artifact.
   */
  updateState(docId: string, state: DocumentState): void;

  /**
   * Append one delivery-history event for `docId`. Append-only: existing
   * history is never edited or removed. Throws if `docId` does not exist.
   */
  appendDeliveryEvent(docId: string, event: DeliveryHistoryEvent): void;

  /**
   * Record where an artifact's bytes were archived and its mandatory
   * retention deadline. Does NOT itself transition `state` — callers
   * archiving a DRAFT row into ORIGINAL call `updateState` separately
   * (see src/archive/index.ts's `archiveArtifact` for the orchestration).
   * Throws if `docId` does not exist, `archiveRef` is empty, or
   * `retentionUntil` is empty — this method is a second line of defense,
   * not the primary enforcement point (that's
   * `assertValidRetentionUntil` in src/archive/archive-store.ts, which
   * every `ArchiveStore.archive()` call runs through before bytes are
   * even written).
   *
   * `rendererVersion` (GAP-15): `<rendererId>@<version>` of the renderer
   * that produced the archived bytes — written in the SAME update as
   * archiveRef so the audit row can never be archived-but-renderer-unknown.
   * Rows archived before this column was written legitimately carry null.
   */
  updateArchiveRef(docId: string, archiveRef: string, retentionUntil: string, rendererVersion: string): void;

  /**
   * Every archived row (`archiveRef` set, not yet purged) whose
   * `retentionUntil` is at or before `now` (ROADMAP Stage 4, "Retention
   * per doc type enforced end-to-end") — the read side
   * `retention-enforcement.ts`'s `enforceRetention` scans to decide what
   * to purge. `now`: RFC 3339 timestamp, so callers can drive this
   * deterministically in tests without depending on wall-clock time.
   */
  listArchivedExpiring(now: string): DocumentRegistryRow[];

  /**
   * Record that `docId`'s archived bytes were purged at `purgedAt`
   * (ROADMAP Stage 4 retention enforcement): clears `archiveRef` to null
   * (the bytes it pointed to no longer exist) and sets `purgedAt` — never
   * deletes the row, never touches `state` or `retentionUntil` (see
   * migrations/0008_add_purged_at.sql for the full reasoning). Throws if
   * `docId` does not exist.
   */
  markPurged(docId: string, purgedAt: string): void;

  /**
   * Every registry row, most-recent-created first (ROADMAP Stage 3
   * "Minimal console, read-only" — Registry screen's read model). See
   * `ListDocumentsQuery` for the search/limit/offset shape.
   */
  listDocuments(query?: ListDocumentsQuery): DocumentRegistryRow[];

  /**
   * Every row minted for one `BusinessEventKey` four-tuple — one per
   * firing `ruleId` (fan-out ⇒ N rows), oldest first, ties by `ruleId`.
   * `OutputPort.status`'s read model (GAP-07): the answer to "what did
   * this business event produce?" without needing any docId. Same
   * columns the five-tuple unique index already covers (migrations/
   * 0003_add_rule_id_to_registry.sql) — no migration.
   */
  listByEventKey(key: BusinessEventKey): DocumentRegistryRow[];

  /**
   * Append one persisted `DeterminationTrace` row (migrations/
   * 0007_add_trace_log.sql — Rule trace console screen's read model). `id`
   * is a docId for a matched determination, or a generated id otherwise —
   * see the migration's own comment for the full id convention and the
   * duplicate-id-is-a-no-op judgment call.
   */
  appendTraceLog(id: string, trace: DeterminationTrace): void;

  /** Fetch a persisted trace by its id (see `appendTraceLog`). Undefined if none exists. */
  getTraceLog(id: string): DeterminationTrace | undefined;

  /**
   * Append one template lifecycle row (Stage 5 task 1; migrations/
   * 0012_add_template_lifecycle.sql) — CHECK-THEN-APPEND in ONE
   * transaction: the row is written only if the key's current state
   * (latest row's `toState`, or `null` when the key has no history) equals
   * `event.fromState`. Returns `true` when appended, `false` when the
   * precondition failed (the key moved underneath the caller, or a seed
   * raced an existing seed) — nothing is written in that case. The caller
   * (src/lifecycle/) evaluates the transition table; this method only
   * guarantees the log can never record a transition from a state the key
   * was not actually in.
   */
  appendTemplateLifecycleEvent(event: TemplateLifecycleEvent): boolean;

  /** The current lifecycle state of `templateId@version` — its latest log
   * row's `toState` — or `undefined` when the key has no history. */
  getTemplateLifecycle(templateId: string, version: string): TemplateLifecycle | undefined;

  /** Every lifecycle row for `templateId@version`, oldest first (the seed
   * row first). `[]` for an unknown key. */
  listTemplateLifecycleHistory(templateId: string, version: string): TemplateLifecycleEvent[];

  /**
   * Append one reprint-log row (Stage 5 task 2; migrations/
   * 0013_add_reprint_log.sql) and return its id — the `reprintLogId` the
   * `reproduce` verb hands back. Append-only: never edited, never deleted.
   * Does NOT check that `event.docId` exists — the caller
   * (embed/create-output.ts) has already fetched and authorized the row.
   */
  appendReprintLog(event: ReprintLogEvent): number;

  /** Every reprint-log row stamped against `docId`, oldest first. `[]`
   * for a docId that was never reproduced/regenerated/reissued. */
  listReprintLog(docId: string): ReprintLogEntry[];

  /** Release the underlying connection/handle. Safe to call once, at shutdown. */
  close(): void;
}
