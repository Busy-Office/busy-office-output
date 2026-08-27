/**
 * Idempotency on BusinessEventKey (ROADMAP Stage 3: "write this test first").
 *
 * These tests exercise `IdempotencyStore` as wired onto the real
 * `RegistryStore` (an in-memory `:memory:` SQLite instance here, for speed
 * and isolation) — proving the same contract from HLD §4 the old in-memory
 * Map stand-in proved, now against durable storage. The
 * persistence-survives-restart guarantee this replaced the Map to get is
 * covered separately in registry/sqlite-registry-store.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { createRegistryIdempotencyStore } from './idempotency-store.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import type { BusinessEventKey } from '@busy-office/output-schema';

function key(overrides: Partial<BusinessEventKey> = {}): BusinessEventKey {
  return {
    businessObject: 'EKKO',
    businessObjectId: '4500001234',
    event: 'po.released',
    templateVersion: '1.0.0',
    ...overrides,
  };
}

function makeStore() {
  return createRegistryIdempotencyStore(createSqliteRegistryStore(':memory:'));
}

describe('registry-backed idempotency store', () => {
  it('replayed event (same four-tuple) returns the existing docId, not a new one', () => {
    const store = makeStore();

    const first = store.getOrCreate(key());
    const second = store.getOrCreate(key());

    expect(second.docId).toBe(first.docId);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
  });

  it('a different four-tuple gets its own docId, first-seen', () => {
    const store = makeStore();

    const first = store.getOrCreate(key());
    const other = store.getOrCreate(key({ businessObjectId: '4500009999' }));

    expect(other.docId).not.toBe(first.docId);
    expect(other.replayed).toBe(false);
  });

  it('templateVersion is part of the key: same object/event, different template, different docId', () => {
    const store = makeStore();

    const first = store.getOrCreate(key());
    const reprocessedOnNewTemplate = store.getOrCreate(key({ templateVersion: '2.0.0' }));

    expect(reprocessedOnNewTemplate.docId).not.toBe(first.docId);
    expect(reprocessedOnNewTemplate.replayed).toBe(false);
  });
});
