/**
 * RegistryStore port (ROADMAP Stage 3, HLD §3 "Data model (registry-centric)":
 * DocumentInstance + DeliveryAttempt). One row per artifact, forever
 * (CLAUDE.md golden rule) — this is the durable replacement for
 * idempotency-store.ts's in-memory Map, and the seam later Stage 3 tasks
 * (archive store, delivery queue) attach to without this file changing.
 *
 * Deliberately minimal for THIS task's DoD — no more than what idempotency
 * replay + a registry row + state + delivery history need:
 *   - getOrCreateByEventKey: the idempotency lookup (replaces
 *     IdempotencyStore.getOrCreate one-for-one), mints docId on first
 *     sighting, returns the same row on replay.
 *   - getByDocId: read a row back by its primary key.
 *   - updateState: transition ORIGINAL/COPY/DUPLICATE/REPRINT/CANCELLED/DRAFT.
 *   - appendDeliveryEvent: append one append-only delivery-history record.
 *   - updateArchiveRef: record where the archived bytes live and the
 *     mandatory retentionUntil deadline for them (added for the Archive
 *     store task — see src/archive/archive-store.ts).
 * Explicitly NOT here: archiving bytes (that's ArchiveStore's job — this
 * port only records the resulting pointer), retention *enforcement*
 * (Stage 4), actually delivering anything, rule TRACE, fan-out — those are
 * separate, later ROADMAP tasks and must not be speculatively added to
 * this port.
 *
 * Backend-agnostic on purpose: this interface has no SQLite (or Postgres)
 * in its signatures. `SqliteRegistryStore` (sqlite-registry-store.ts) is the
 * only implementation right now — a Postgres implementation is explicitly
 * out of scope, gated on ADR-004 ("if the registry lands on Postgres
 * anyway"). Nothing here should make that later implementation awkward.
 */
import type { BusinessEventKey } from '@busy-office/output-schema';

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
   * migrations/0002_add_retention_until.sql. */
  retentionUntil: string | null;
  /**
   * The firing `OutputRule.id` that produced this resolution (see
   * `ResolutionEventKey` above). `''` for rows minted via the plain
   * four-tuple `getOrCreateByEventKey` (pre-fan-out callers, and any
   * caller that genuinely has no rule to disambiguate by) — never `null`,
   * so it composes cleanly with the unique index's NOT NULL column.
   */
  ruleId: string;
  state: DocumentState;
  createdAt: string;
  updatedAt: string;
  deliveryHistory: DeliveryHistoryEvent[];
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
   */
  getOrCreateByEventKey(key: BusinessEventKey): GetOrCreateResult;

  /**
   * The fan-out-aware idempotency lookup (see `ResolutionEventKey` above):
   * first sighting of the five-tuple (four-tuple + ruleId) mints a new
   * docId and inserts a DRAFT row; any later call with an equal five-tuple
   * returns the SAME row, unchanged. `getOrCreateByEventKey` is exactly
   * this method called with `ruleId: ''` — the two share one
   * implementation and one unique index, so a plain four-tuple lookup and
   * a ruleId-disambiguated lookup can never disagree about identity.
   */
  getOrCreateByResolutionKey(key: ResolutionEventKey): GetOrCreateResult;

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
   */
  mintWithOutbox(key: ResolutionEventKey, resolution: unknown, data: unknown): GetOrCreateResult;

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
   */
  updateArchiveRef(docId: string, archiveRef: string, retentionUntil: string): void;

  /** Release the underlying connection/handle. Safe to call once, at shutdown. */
  close(): void;
}
