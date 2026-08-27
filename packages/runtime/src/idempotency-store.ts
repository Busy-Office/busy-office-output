/**
 * Idempotency on BusinessEventKey (ROADMAP Stage 3, HLD §4): "Idempotency
 * key (businessObject, businessObjectId, event, templateVersion): replay
 * returns the existing docId."
 *
 * SCOPE: this is a process-lifetime, in-memory stand-in, not the persisted
 * document registry. The registry is a separate, later ROADMAP task
 * ("Document registry ... — DoD: one row per artifact, migration in repo")
 * that will own docId issuance for real, backed by durable storage with
 * template+renderer versions, input/output hashes, archiveRef, state, and
 * delivery history. This store exists solely to prove the idempotency
 * *contract* ahead of that: same four-tuple in, same docId out, without
 * re-processing. When the registry lands, this module is replaced, not
 * extended in place.
 */
import { randomUUID } from 'node:crypto';
import type { BusinessEventKey } from '@busy-office/output-schema';

export interface IdempotencyResult {
  docId: string;
  /** true when this four-tuple was already seen; false on first sighting. */
  replayed: boolean;
}

export interface IdempotencyStore {
  /**
   * First sighting of `key`: mints a new docId, records it, returns
   * { docId, replayed: false }. Any later call with an equal four-tuple
   * returns the SAME docId with { replayed: true } — no new work is done.
   */
  getOrCreate(key: BusinessEventKey): IdempotencyResult;
}

/** Canonical string form of the four-tuple for use as a Map key. */
function canonicalKey(key: BusinessEventKey): string {
  return JSON.stringify([key.businessObject, key.businessObjectId, key.event, key.templateVersion]);
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const seen = new Map<string, string>(); // canonical key -> docId

  return {
    getOrCreate(key: BusinessEventKey): IdempotencyResult {
      const canonical = canonicalKey(key);
      const existing = seen.get(canonical);
      if (existing !== undefined) {
        return { docId: existing, replayed: true };
      }
      const docId = randomUUID();
      seen.set(canonical, docId);
      return { docId, replayed: false };
    },
  };
}
