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
 * Explicitly NOT here: archiving bytes, retention enforcement, actually
 * delivering anything, rule TRACE, fan-out — those are separate, later
 * ROADMAP tasks and must not be speculatively added to this port.
 *
 * Backend-agnostic on purpose: this interface has no SQLite (or Postgres)
 * in its signatures. `SqliteRegistryStore` (sqlite-registry-store.ts) is the
 * only implementation right now — a Postgres implementation is explicitly
 * out of scope, gated on ADR-004 ("if the registry lands on Postgres
 * anyway"). Nothing here should make that later implementation awkward.
 */
import type { BusinessEventKey } from '@busy-office/output-schema';

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
  /** Pointer into the (not-yet-built) archive store. Null until archived. */
  archiveRef: string | null;
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

export interface RegistryStore {
  /**
   * The idempotency lookup (HLD §4): first sighting of `key` mints a new
   * docId and inserts a DRAFT row, returning { created: true }. Any later
   * call with an equal four-tuple returns the SAME row, unchanged, with
   * { created: false } — no new work, no new row.
   */
  getOrCreateByEventKey(key: BusinessEventKey): GetOrCreateResult;

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

  /** Release the underlying connection/handle. Safe to call once, at shutdown. */
  close(): void;
}
