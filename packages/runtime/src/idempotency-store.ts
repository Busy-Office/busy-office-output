/**
 * Idempotency on BusinessEventKey (ROADMAP Stage 3, HLD §4): "Idempotency
 * key (businessObject, businessObjectId, event, templateVersion): replay
 * returns the existing docId."
 *
 * This module now sits directly on top of the durable `RegistryStore`
 * (registry/registry-store.ts) — the in-memory `Map` stand-in it used to
 * hold is gone, replaced rather than extended, exactly as its old header
 * comment promised. `IdempotencyStore` stays a thin, purpose-named facade
 * (same external contract server.ts already depends on: `getOrCreate` ->
 * `{ docId, replayed }`) over `RegistryStore.getOrCreateByEventKey`, which
 * does the real, persisted work: mint-or-fetch a DRAFT registry row keyed
 * on the four-tuple, backed by SQLite (see sqlite-registry-store.ts), so a
 * replayed event returns the same docId even across a process restart.
 */
import type { BusinessEventKey } from '@busy-office/output-schema';
import type { RegistryStore } from './registry/registry-store.js';

export interface IdempotencyResult {
  docId: string;
  /** true when this four-tuple was already seen; false on first sighting. */
  replayed: boolean;
}

export interface IdempotencyStore {
  /**
   * First sighting of `key`: mints a new docId (via a new DRAFT registry
   * row), returns { docId, replayed: false }. Any later call with an equal
   * four-tuple returns the SAME docId with { replayed: true } — no new row,
   * no new work.
   */
  getOrCreate(key: BusinessEventKey): IdempotencyResult;
}

/** Wraps a `RegistryStore` to satisfy the `IdempotencyStore` contract. */
export function createRegistryIdempotencyStore(registryStore: RegistryStore): IdempotencyStore {
  return {
    getOrCreate(key: BusinessEventKey): IdempotencyResult {
      const { row, created } = registryStore.getOrCreateByEventKey(key);
      return { docId: row.docId, replayed: !created };
    },
  };
}
