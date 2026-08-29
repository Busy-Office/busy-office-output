/**
 * archiveArtifact wiring (ROADMAP Stage 3, "Archive store ... wired into
 * the registry"). Proves the DRAFT -> ORIGINAL transition with archiveRef
 * + retentionUntil set, and that a failed archive attempt leaves the
 * registry row untouched (still DRAFT, no archiveRef).
 */
import { describe, expect, it } from 'vitest';
import type { BusinessEventKey } from '@busy-office/output-schema';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import { FsArchiveStore } from './fs-archive-store.js';
import { archiveArtifact } from './index.js';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function key(overrides: Partial<BusinessEventKey> = {}): BusinessEventKey {
  return {
    businessObject: 'EKKO',
    businessObjectId: '4500009999',
    event: 'po.released',
    templateVersion: '1.0.0',
    ...overrides,
  };
}

describe('archiveArtifact', () => {
  it('archives bytes and transitions the registry row DRAFT -> ORIGINAL with archiveRef + retentionUntil set', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'archive-wiring-test-'));
    const archiveStore = new FsArchiveStore(dir);

    const { row } = registryStore.getOrCreateByEventKey(key());
    expect(row.state).toBe('DRAFT');
    expect(row.archiveRef).toBeNull();
    expect(row.retentionUntil).toBeNull();

    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact');
    const archiveRef = await archiveArtifact({
      archiveStore,
      registryStore,
      docId: row.docId,
      bytes,
      mediaType: 'application/pdf',
      retentionUntil: '2033-01-01T00:00:00Z',
      renderer: { id: 'fake-renderer', version: '9.9.9' },
    });

    const updated = registryStore.getByDocId(row.docId);
    expect(updated?.state).toBe('ORIGINAL');
    expect(updated?.archiveRef).toBe(archiveRef);
    expect(updated?.retentionUntil).toBe('2033-01-01T00:00:00Z');
    // GAP-15: rendererId@version lands in the same write as archiveRef.
    expect(updated?.rendererVersion).toBe('fake-renderer@9.9.9');

    // And the bytes are actually retrievable back through the store.
    const retrieved = await archiveStore.retrieve(archiveRef);
    expect(Buffer.from(retrieved)).toEqual(Buffer.from(bytes));

    registryStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a failed archive (missing retentionUntil) leaves the registry row untouched', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'archive-wiring-fail-test-'));
    const archiveStore = new FsArchiveStore(dir);

    const { row } = registryStore.getOrCreateByEventKey(key());
    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact');

    await expect(
      archiveArtifact({
        archiveStore,
        registryStore,
        docId: row.docId,
        bytes,
        mediaType: 'application/pdf',
        retentionUntil: undefined as unknown as string,
        renderer: { id: 'fake-renderer', version: '9.9.9' },
      }),
    ).rejects.toThrow(TypeError);

    const unchanged = registryStore.getByDocId(row.docId);
    expect(unchanged?.state).toBe('DRAFT');
    expect(unchanged?.archiveRef).toBeNull();
    expect(unchanged?.retentionUntil).toBeNull();
    expect(unchanged?.rendererVersion).toBeNull();

    registryStore.close();
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an unidentifiable renderer (empty version) is rejected before any bytes are written — no archived-but-renderer-unknown row', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'archive-wiring-renderer-test-'));
    const archiveStore = new FsArchiveStore(dir);

    const { row } = registryStore.getOrCreateByEventKey(key());

    await expect(
      archiveArtifact({
        archiveStore,
        registryStore,
        docId: row.docId,
        bytes: new TextEncoder().encode('%PDF-1.7 fake artifact'),
        mediaType: 'application/pdf',
        retentionUntil: '2033-01-01T00:00:00Z',
        renderer: { id: 'typst', version: '' },
      }),
    ).rejects.toThrow(TypeError);

    const unchanged = registryStore.getByDocId(row.docId);
    expect(unchanged?.state).toBe('DRAFT');
    expect(unchanged?.archiveRef).toBeNull();
    expect(unchanged?.rendererVersion).toBeNull();
    // Nothing reached the archive store.
    expect(readdirSync(dir)).toEqual([]);

    registryStore.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
