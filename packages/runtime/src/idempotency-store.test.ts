/**
 * Idempotency on BusinessEventKey (ROADMAP Stage 3: "write this test first").
 *
 * This is a process-lifetime, in-memory stand-in for the persisted document
 * registry that a later, separate ROADMAP task builds ("Document registry
 * (docId, object/id, template+renderer versions, input/output hashes,
 * archiveRef, state, delivery history) — DoD: one row per artifact,
 * migration in repo"). It exists only to prove the idempotency *contract*
 * from HLD §4: "Idempotency key (businessObject, businessObjectId, event,
 * templateVersion): replay returns the existing docId." Do not grow this
 * into the registry in place — the registry task replaces it.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryIdempotencyStore } from './idempotency-store.js';
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

describe('in-memory idempotency store', () => {
  it('replayed event (same four-tuple) returns the existing docId, not a new one', () => {
    const store = createInMemoryIdempotencyStore();

    const first = store.getOrCreate(key());
    const second = store.getOrCreate(key());

    expect(second.docId).toBe(first.docId);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
  });

  it('a different four-tuple gets its own docId, first-seen', () => {
    const store = createInMemoryIdempotencyStore();

    const first = store.getOrCreate(key());
    const other = store.getOrCreate(key({ businessObjectId: '4500009999' }));

    expect(other.docId).not.toBe(first.docId);
    expect(other.replayed).toBe(false);
  });

  it('templateVersion is part of the key: same object/event, different template, different docId', () => {
    const store = createInMemoryIdempotencyStore();

    const first = store.getOrCreate(key());
    const reprocessedOnNewTemplate = store.getOrCreate(key({ templateVersion: '2.0.0' }));

    expect(reprocessedOnNewTemplate.docId).not.toBe(first.docId);
    expect(reprocessedOnNewTemplate.replayed).toBe(false);
  });
});
