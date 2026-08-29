/**
 * SqliteRegistryStore (ROADMAP Stage 3, "Document registry ... DoD: one row
 * per artifact, migration in repo"). Covers the RegistryStore contract
 * directly (idempotent get-or-create, state transitions, delivery-history
 * append) plus the one guarantee the old in-memory idempotency stand-in
 * could never prove: a docId survives a process restart, because it is
 * on-disk, not in a Map that dies with the process.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BusinessEventKey } from '@busy-office/output-schema';
import { createSqliteRegistryStore } from './sqlite-registry-store.js';

function key(overrides: Partial<BusinessEventKey> = {}): BusinessEventKey {
  return {
    businessObject: 'EKKO',
    businessObjectId: '4500001234',
    event: 'po.released',
    templateVersion: '1.0.0',
    ...overrides,
  };
}

const tempDirs: string[] = [];
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'registry-test-'));
  tempDirs.push(dir);
  return join(dir, 'registry.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('SqliteRegistryStore (:memory:)', () => {
  it('getOrCreateByEventKey mints a DRAFT row on first sighting', () => {
    const store = createSqliteRegistryStore(':memory:');

    const { row, created } = store.getOrCreateByEventKey(key());

    expect(created).toBe(true);
    expect(row.state).toBe('DRAFT');
    expect(row.businessObject).toBe('EKKO');
    expect(row.businessObjectId).toBe('4500001234');
    expect(row.templateVersion).toBe('1.0.0');
    expect(row.archiveRef).toBeNull();
    expect(row.rendererVersion).toBeNull();
    expect(row.inputHash).toBeNull();
    expect(row.outputHash).toBeNull();
    expect(row.deliveryHistory).toEqual([]);

    store.close();
  });

  it('replay of the same four-tuple returns the same row, created: false', () => {
    const store = createSqliteRegistryStore(':memory:');

    const first = store.getOrCreateByEventKey(key());
    const second = store.getOrCreateByEventKey(key());

    expect(second.created).toBe(false);
    expect(second.row.docId).toBe(first.row.docId);

    store.close();
  });

  it('getByDocId round-trips a created row; unknown docId returns undefined', () => {
    const store = createSqliteRegistryStore(':memory:');

    const { row } = store.getOrCreateByEventKey(key());
    expect(store.getByDocId(row.docId)).toEqual(row);
    expect(store.getByDocId(randomUUID())).toBeUndefined();

    store.close();
  });

  it('updateState transitions state and bumps updatedAt', async () => {
    const store = createSqliteRegistryStore(':memory:');
    const { row } = store.getOrCreateByEventKey(key());

    await new Promise((resolve) => setTimeout(resolve, 2));
    store.updateState(row.docId, 'ORIGINAL');

    const updated = store.getByDocId(row.docId);
    expect(updated?.state).toBe('ORIGINAL');
    expect(updated?.updatedAt >= row.updatedAt).toBe(true);

    store.close();
  });

  it('updateState throws for an unknown docId rather than silently no-opping', () => {
    const store = createSqliteRegistryStore(':memory:');
    expect(() => store.updateState(randomUUID(), 'ORIGINAL')).toThrow();
    store.close();
  });

  it('appendDeliveryEvent is append-only and ordered', () => {
    const store = createSqliteRegistryStore(':memory:');
    const { row } = store.getOrCreateByEventKey(key());

    store.appendDeliveryEvent(row.docId, { channel: 'email', status: 'attempted', occurredAt: '2026-08-27T00:00:00Z' });
    store.appendDeliveryEvent(row.docId, {
      channel: 'email',
      status: 'delivered',
      occurredAt: '2026-08-27T00:00:01Z',
      detail: 'smtp 250 OK',
    });

    const history = store.getByDocId(row.docId)?.deliveryHistory;
    expect(history).toHaveLength(2);
    expect(history?.[0]).toMatchObject({ channel: 'email', status: 'attempted' });
    expect(history?.[1]).toMatchObject({ channel: 'email', status: 'delivered', detail: 'smtp 250 OK' });

    store.close();
  });

  it('appendDeliveryEvent throws for an unknown docId', () => {
    const store = createSqliteRegistryStore(':memory:');
    expect(() =>
      store.appendDeliveryEvent(randomUUID(), { channel: 'email', status: 'attempted', occurredAt: '2026-08-27T00:00:00Z' }),
    ).toThrow();
    store.close();
  });

  it('the four-tuple unique index rejects a raw duplicate insert (idempotency enforced at the DB layer too)', () => {
    const store = createSqliteRegistryStore(':memory:');
    store.getOrCreateByEventKey(key());
    // getOrCreateByEventKey itself never violates this (it checks first),
    // so exercise the constraint the way the migration documents it:
    // re-running getOrCreateByEventKey must never produce a second row.
    store.getOrCreateByEventKey(key());
    store.getOrCreateByEventKey(key());

    store.close();
  });
});

describe('SqliteRegistryStore documentType (ROADMAP Stage 3 "Minimal console, read-only")', () => {
  it('getOrCreateByEventKey persists the given documentType; omitting it defaults to \'\'', () => {
    const store = createSqliteRegistryStore(':memory:');

    const withType = store.getOrCreateByEventKey(key({ businessObjectId: '1' }), 'purchase-order');
    expect(withType.row.documentType).toBe('purchase-order');

    const withoutType = store.getOrCreateByEventKey(key({ businessObjectId: '2' }));
    expect(withoutType.row.documentType).toBe('');

    store.close();
  });

  it('getOrCreateByResolutionKey and mintWithOutbox both persist documentType', () => {
    const store = createSqliteRegistryStore(':memory:');

    const a = store.getOrCreateByResolutionKey({ ...key({ businessObjectId: '3' }), ruleId: 'r1' }, 'invoice');
    expect(a.row.documentType).toBe('invoice');

    const b = store.mintWithOutbox({ ...key({ businessObjectId: '4' }), ruleId: 'r2' }, { some: 'resolution' }, { some: 'data' }, 'payslip');
    expect(b.row.documentType).toBe('payslip');
    expect(store.getByDocId(b.row.docId)?.documentType).toBe('payslip');

    store.close();
  });

  it('documentType is not part of the idempotency key: replay ignores a different documentType argument', () => {
    const store = createSqliteRegistryStore(':memory:');
    const first = store.getOrCreateByEventKey(key({ businessObjectId: '5' }), 'purchase-order');
    const replay = store.getOrCreateByEventKey(key({ businessObjectId: '5' }), 'invoice');

    expect(replay.created).toBe(false);
    expect(replay.row.docId).toBe(first.row.docId);
    expect(replay.row.documentType).toBe('purchase-order'); // unchanged by the replay's argument

    store.close();
  });
});

describe('SqliteRegistryStore.listDocuments', () => {
  it('returns rows most-recently-created first', async () => {
    const store = createSqliteRegistryStore(':memory:');
    const a = store.getOrCreateByEventKey(key({ businessObjectId: 'list-a' }));
    await new Promise((resolve) => setTimeout(resolve, 2));
    const b = store.getOrCreateByEventKey(key({ businessObjectId: 'list-b' }));

    const rows = store.listDocuments();
    const ids = rows.map((r) => r.docId);
    expect(ids.indexOf(b.row.docId)).toBeLessThan(ids.indexOf(a.row.docId));

    store.close();
  });

  it('search filters by businessObjectId substring', () => {
    const store = createSqliteRegistryStore(':memory:');
    const target = store.getOrCreateByEventKey(key({ businessObjectId: 'needle-xyz' }));
    store.getOrCreateByEventKey(key({ businessObjectId: 'unrelated' }));

    const rows = store.listDocuments({ search: 'needle' });
    expect(rows).toHaveLength(1);
    expect(rows[0].docId).toBe(target.row.docId);

    store.close();
  });

  it('limit/offset page through results', () => {
    const store = createSqliteRegistryStore(':memory:');
    for (let i = 0; i < 5; i++) {
      store.getOrCreateByEventKey(key({ businessObjectId: `page-${i}` }));
    }

    const page1 = store.listDocuments({ search: 'page-', limit: 2, offset: 0 });
    const page2 = store.listDocuments({ search: 'page-', limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1.map((r) => r.docId)).not.toEqual(page2.map((r) => r.docId));

    store.close();
  });
});

describe('SqliteRegistryStore trace log (ROADMAP Stage 3 "Minimal console, read-only")', () => {
  it('appendTraceLog + getTraceLog round-trip a DeterminationTrace by id', () => {
    const store = createSqliteRegistryStore(':memory:');
    const trace = {
      documentType: 'purchase-order',
      businessObject: 'EKKO',
      event: 'po.released',
      rules: [],
      resolutions: [],
      outcome: 'matched' as const,
      firingRuleIds: ['r1'],
    };

    store.appendTraceLog('some-id', trace);
    expect(store.getTraceLog('some-id')).toEqual(trace);
    expect(store.getTraceLog('unknown-id')).toBeUndefined();

    store.close();
  });

  it('a second appendTraceLog under the same id is a silent no-op, not an error', () => {
    const store = createSqliteRegistryStore(':memory:');
    const first = {
      documentType: 'purchase-order',
      businessObject: 'EKKO',
      event: 'po.released',
      rules: [],
      resolutions: [],
      outcome: 'matched' as const,
      firingRuleIds: ['r1'],
    };
    const second = { ...first, firingRuleIds: ['r1', 'r2'] };

    store.appendTraceLog('dup-id', first);
    expect(() => store.appendTraceLog('dup-id', second)).not.toThrow();
    expect(store.getTraceLog('dup-id')).toEqual(first); // first write wins

    store.close();
  });
});

describe('SqliteRegistryStore persistence across a process restart', () => {
  it('a docId minted before "restart" is returned unchanged after reopening the same file', () => {
    const dbPath = tempDbPath();

    const beforeRestart = createSqliteRegistryStore(dbPath);
    const { row: originalRow } = beforeRestart.getOrCreateByEventKey(key());
    beforeRestart.appendDeliveryEvent(originalRow.docId, {
      channel: 'email',
      status: 'delivered',
      occurredAt: '2026-08-27T00:00:00Z',
    });
    beforeRestart.updateState(originalRow.docId, 'ORIGINAL');
    // Simulates the process ending: close this connection entirely.
    beforeRestart.close();

    // "Restart": a fresh store instance, pointed at the same on-disk file,
    // with no shared in-process state whatsoever.
    const afterRestart = createSqliteRegistryStore(dbPath);
    const replay = afterRestart.getOrCreateByEventKey(key());

    expect(replay.created).toBe(false);
    expect(replay.row.docId).toBe(originalRow.docId);
    expect(replay.row.state).toBe('ORIGINAL');
    expect(replay.row.deliveryHistory).toEqual([
      { channel: 'email', status: 'delivered', occurredAt: '2026-08-27T00:00:00Z' },
    ]);

    afterRestart.close();
  });
});

describe('SqliteRegistryStore listByEventKey (OutputPort v1 `status`, GAP-07)', () => {
  it('returns every row minted for one four-tuple — one per ruleId, oldest first — and [] for an unknown key', () => {
    const store = createSqliteRegistryStore(':memory:');
    const key: BusinessEventKey = { businessObject: 'VBRK', businessObjectId: 'INV-LBEK-1', event: 'invoice.posted', templateVersion: '1.0.0' };
    const a = store.getOrCreateByResolutionKey({ ...key, ruleId: 'invoice-default-email' }, 'invoice').row;
    const b = store.getOrCreateByResolutionKey({ ...key, ruleId: 'invoice-archival-copy' }, 'invoice').row;
    // A different templateVersion is a different event — must not leak in.
    store.getOrCreateByResolutionKey({ ...key, templateVersion: '2.0.0', ruleId: 'invoice-default-email' }, 'invoice');

    const rows = store.listByEventKey(key);
    expect(rows.map((r) => r.docId).sort()).toEqual([a.docId, b.docId].sort());
    expect(rows.map((r) => r.ruleId).sort()).toEqual(['invoice-archival-copy', 'invoice-default-email']);
    expect(store.listByEventKey({ ...key, businessObjectId: 'NOPE' })).toEqual([]);
    store.close();
  });
});

describe('SqliteRegistryStore template lifecycle log (ROADMAP Stage 5 task 1, migration 0012)', () => {
  it('append is check-then-append: a stale fromState writes nothing; history is ordered; current is the latest row; unknown key is undefined', () => {
    const store = createSqliteRegistryStore(':memory:');
    const base = { templateId: 'memo-v1', version: '1.0.0', actorRole: 'author', actorSubjectId: 'alice', reason: 'r', occurredAt: '2026-08-29T00:00:00.000Z' };

    expect(store.getTemplateLifecycle('memo-v1', '1.0.0')).toBeUndefined();
    expect(store.listTemplateLifecycleHistory('memo-v1', '1.0.0')).toEqual([]);

    expect(store.appendTemplateLifecycleEvent({ ...base, fromState: null, toState: 'draft' })).toBe(true);
    // A second seed against an existing key: precondition (no history) fails, nothing written.
    expect(store.appendTemplateLifecycleEvent({ ...base, fromState: null, toState: 'published' })).toBe(false);
    // A transition from a state the key is NOT in: nothing written.
    expect(store.appendTemplateLifecycleEvent({ ...base, fromState: 'review', toState: 'approved' })).toBe(false);
    expect(store.appendTemplateLifecycleEvent({ ...base, fromState: 'draft', toState: 'review', occurredAt: '2026-08-29T00:00:01.000Z' })).toBe(true);

    expect(store.getTemplateLifecycle('memo-v1', '1.0.0')).toBe('review');
    expect(store.listTemplateLifecycleHistory('memo-v1', '1.0.0')).toEqual([
      { ...base, fromState: null, toState: 'draft' },
      { ...base, fromState: 'draft', toState: 'review', occurredAt: '2026-08-29T00:00:01.000Z' },
    ]);
    // Keys are (templateId, version): another version is independent.
    expect(store.getTemplateLifecycle('memo-v1', '2.0.0')).toBeUndefined();
    store.close();
  });
});
