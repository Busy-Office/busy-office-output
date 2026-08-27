/**
 * FsArchiveStore (ROADMAP Stage 3, "Archive store (FS + S3-compatible)
 * with mandatory retentionUntil"). Covers: archiving without retention
 * fails (the DoD), a real round-trip archive -> retrieve, and that a
 * failed archive() call never leaves partial bytes on disk.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsArchiveStore } from './fs-archive-store.js';

const tempDirs: string[] = [];
function tempRootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'archive-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('FsArchiveStore', () => {
  it('archiving without retentionUntil fails (DoD)', async () => {
    const store = new FsArchiveStore(tempRootDir());
    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact bytes');

    // @ts-expect-error deliberately omitting the mandatory field
    await expect(store.archive({ bytes, mediaType: 'application/pdf' })).rejects.toThrow(TypeError);
    await expect(
      store.archive({ bytes, mediaType: 'application/pdf', retentionUntil: null as unknown as string }),
    ).rejects.toThrow(TypeError);
    await expect(
      store.archive({ bytes, mediaType: 'application/pdf', retentionUntil: 'not-a-date' }),
    ).rejects.toThrow(TypeError);
  });

  it('a failed archive() call (bad retentionUntil) leaves no bytes on disk', async () => {
    const root = tempRootDir();
    const store = new FsArchiveStore(root);
    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact bytes');

    await expect(
      store.archive({ bytes, mediaType: 'application/pdf', retentionUntil: 'garbage' }),
    ).rejects.toThrow();

    const entries = await readdir(root);
    expect(entries).toEqual([]);
  });

  it('round-trips: archive() then retrieve() returns the same bytes', async () => {
    const store = new FsArchiveStore(tempRootDir());
    const bytes = new TextEncoder().encode('%PDF-1.7 fake artifact bytes for round-trip');

    const archiveRef = await store.archive({
      bytes,
      mediaType: 'application/pdf',
      retentionUntil: '2030-01-01T00:00:00Z',
    });

    expect(typeof archiveRef).toBe('string');
    expect(archiveRef.length).toBeGreaterThan(0);

    const retrieved = await store.retrieve(archiveRef);
    expect(Buffer.from(retrieved)).toEqual(Buffer.from(bytes));
  });

  it('rejects empty bytes', async () => {
    const store = new FsArchiveStore(tempRootDir());
    await expect(
      store.archive({ bytes: new Uint8Array(0), mediaType: 'application/pdf', retentionUntil: '2030-01-01T00:00:00Z' }),
    ).rejects.toThrow(TypeError);
  });

  it('retrieve() rejects for an archiveRef that was never archived', async () => {
    const store = new FsArchiveStore(tempRootDir());
    await expect(store.retrieve('ab/never-existed')).rejects.toThrow();
  });
});
