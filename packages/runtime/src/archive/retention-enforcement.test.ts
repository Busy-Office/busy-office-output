/**
 * enforceRetention (ROADMAP Stage 4, "Retention per doc type enforced
 * end-to-end" — DoD: "expiry test purges artifact, registry row
 * survives"). The DoD test: archive a real artifact with a
 * `retentionUntil` in the past, run `enforceRetention` with an injectable
 * `now`, and assert (a) the archive store no longer has the bytes, (b) the
 * registry row still exists and is queryable, and (c) the row carries a
 * clear, legible signal that it was purged (not a silently-missing
 * archiveRef).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BusinessEventKey } from '@busy-office/output-schema';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import { FsArchiveStore } from './fs-archive-store.js';
import { archiveArtifact } from './index.js';
import { enforceRetention } from './retention-enforcement.js';

function key(overrides: Partial<BusinessEventKey> = {}): BusinessEventKey {
  return {
    businessObject: 'PurchaseOrderHeader',
    businessObjectId: 'PO-0009999',
    event: 'po.released',
    templateVersion: '1.0.0',
    ...overrides,
  };
}

function tempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('enforceRetention', () => {
  it('purges an expired artifact\'s bytes while the registry row survives, legibly marked purged (DoD)', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const { dir, cleanup } = tempDir('retention-enforcement-test-');
    const archiveStore = new FsArchiveStore(dir);

    const { row } = registryStore.getOrCreateByEventKey(key());
    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact bytes');

    const archiveRef = await archiveArtifact({
      archiveStore,
      registryStore,
      docId: row.docId,
      bytes,
      mediaType: 'application/pdf',
      // Already in the past relative to `now` below.
      retentionUntil: '2020-01-01T00:00:00Z',
      renderer: { id: 'fake-renderer', version: '0.0.1' },
      inputHash: 'test-input-hash',
    });

    // Sanity: bytes are really there before enforcement runs.
    await expect(archiveStore.retrieve(archiveRef)).resolves.toBeInstanceOf(Uint8Array);

    const results = await enforceRetention({ registryStore, archiveStore }, '2026-08-28T00:00:00Z');

    expect(results).toEqual([
      {
        docId: row.docId,
        outcome: 'purged',
        archiveRef,
        purgedAt: expect.any(String),
      },
    ]);

    // (a) the archive store no longer has the bytes.
    await expect(archiveStore.retrieve(archiveRef)).rejects.toThrow();

    // (b) the registry row still exists and is queryable.
    const purgedRow = registryStore.getByDocId(row.docId);
    expect(purgedRow).toBeDefined();

    // (c) the row shows a clear, legible purge signal, not a silent gap:
    // archiveRef cleared (nothing to point at any more), purgedAt set,
    // and retentionUntil/state left as the historical record.
    expect(purgedRow?.archiveRef).toBeNull();
    expect(purgedRow?.purgedAt).toEqual(expect.any(String));
    expect(purgedRow?.retentionUntil).toBe('2020-01-01T00:00:00Z');
    expect(purgedRow?.state).toBe('ORIGINAL');

    registryStore.close();
    cleanup();
  });

  it('leaves unexpired artifacts untouched', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const { dir, cleanup } = tempDir('retention-enforcement-unexpired-test-');
    const archiveStore = new FsArchiveStore(dir);

    const { row } = registryStore.getOrCreateByEventKey(key());
    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact bytes');
    const archiveRef = await archiveArtifact({
      archiveStore,
      registryStore,
      docId: row.docId,
      bytes,
      mediaType: 'application/pdf',
      retentionUntil: '2099-01-01T00:00:00Z',
      renderer: { id: 'fake-renderer', version: '0.0.1' },
      inputHash: 'test-input-hash',
    });

    const results = await enforceRetention({ registryStore, archiveStore }, '2026-08-28T00:00:00Z');
    expect(results).toEqual([]);

    const untouched = registryStore.getByDocId(row.docId);
    expect(untouched?.archiveRef).toBe(archiveRef);
    expect(untouched?.purgedAt).toBeNull();
    await expect(archiveStore.retrieve(archiveRef)).resolves.toBeInstanceOf(Uint8Array);

    registryStore.close();
    cleanup();
  });

  it('a purge is idempotent: running enforceRetention twice never errors and stays purged', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const { dir, cleanup } = tempDir('retention-enforcement-idempotent-test-');
    const archiveStore = new FsArchiveStore(dir);

    const { row } = registryStore.getOrCreateByEventKey(key());
    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact bytes');
    await archiveArtifact({
      archiveStore,
      registryStore,
      docId: row.docId,
      bytes,
      mediaType: 'application/pdf',
      retentionUntil: '2020-01-01T00:00:00Z',
      renderer: { id: 'fake-renderer', version: '0.0.1' },
      inputHash: 'test-input-hash',
    });

    const first = await enforceRetention({ registryStore, archiveStore }, '2026-08-28T00:00:00Z');
    expect(first).toHaveLength(1);

    // Second run: the row's archiveRef is now null, so listArchivedExpiring
    // no longer surfaces it — nothing left to purge, not an error.
    const second = await enforceRetention({ registryStore, archiveStore }, '2026-08-28T00:00:00Z');
    expect(second).toEqual([]);

    registryStore.close();
    cleanup();
  });
});
