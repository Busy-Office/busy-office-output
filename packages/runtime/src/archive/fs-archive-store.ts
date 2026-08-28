/**
 * FsArchiveStore: the default embedded `ArchiveStore` implementation
 * (ROADMAP Stage 3, "Archive store (FS + S3-compatible)"). Writes bytes to
 * a local directory — what single-process `serve()` uses by default
 * (CLAUDE.md: "API + worker + embedded queue + FS archive in one
 * command"), living under the same `./data/` root as the SQLite registry
 * (`./data/registry.db` — see src/index.ts's `defaultRegistryDbPath`),
 * which is already gitignored (`/data/` in .gitignore).
 *
 * archiveRef shape: a relative path (POSIX separators) under this store's
 * root, e.g. "3f/3fa85f64-....pdf" — NOT a `file://` URI. Chosen because
 * (a) it round-trips through `join(rootDir, archiveRef)` with no URL
 * parsing/escaping concerns, (b) it stays portable if the root directory
 * moves (a `file://` URI would bake in an absolute path), and (c) it
 * mirrors the S3 backend's convention of storing only a "location within
 * this store," not a fully resolved address. The two-hex-char shard
 * prefix (first two hex chars of the artifact's id) keeps the directory
 * from accumulating tens of thousands of files in one flat listing at
 * production volumes — cheap now, avoids a rewrite later.
 *
 * A small JSON sidecar (`<id>.meta.json`) is written next to the bytes
 * recording `mediaType` and `retentionUntil` — retrieve() doesn't need it
 * today (the ArchiveStore port only returns bytes), but the alternative is
 * losing that information the moment archive() returns, which would make
 * Stage 4's retention-enforcement task have nowhere to read it from.
 * (The registry also persists `retentionUntil` per artifact — see
 * migrations/0002_add_retention_until.sql — so this sidecar is redundant
 * insurance, not the source of truth.)
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertValidRetentionUntil } from './archive-store.js';
import type { ArchiveInput, ArchiveStore } from './archive-store.js';

export class FsArchiveStore implements ArchiveStore {
  constructor(private readonly rootDir: string) {}

  async archive(input: ArchiveInput): Promise<string> {
    const retentionUntil = assertValidRetentionUntil(input.retentionUntil);
    if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) {
      throw new TypeError('archive() requires non-empty artifact bytes.');
    }
    if (typeof input.mediaType !== 'string' || input.mediaType.trim() === '') {
      throw new TypeError('archive() requires a non-empty mediaType.');
    }

    const id = randomUUID();
    const archiveRef = join(id.slice(0, 2), id);
    const fullPath = join(this.rootDir, archiveRef);
    const metaPath = `${fullPath}.meta.json`;

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.bytes);
    await writeFile(
      metaPath,
      JSON.stringify({
        mediaType: input.mediaType,
        retentionUntil,
        archivedAt: new Date().toISOString(),
      }),
      'utf8',
    );

    return archiveRef;
  }

  async retrieve(archiveRef: string): Promise<Uint8Array> {
    const fullPath = join(this.rootDir, archiveRef);
    const buf = await readFile(fullPath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Deletes the bytes file and its `.meta.json` sidecar. Idempotent —
   * ENOENT on either is swallowed, since "already gone" is exactly the
   * post-condition a purge is trying to reach. */
  async purge(archiveRef: string): Promise<void> {
    const fullPath = join(this.rootDir, archiveRef);
    const metaPath = `${fullPath}.meta.json`;
    await Promise.all([this.unlinkIfExists(fullPath), this.unlinkIfExists(metaPath)]);
  }

  private async unlinkIfExists(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
