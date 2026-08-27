/**
 * Archive module barrel + the registry-wiring orchestration (ROADMAP
 * Stage 3, "Archive store ... DoD: archiving without retention fails").
 *
 * `archiveArtifact` is the one place that ties `ArchiveStore` (bytes in,
 * archiveRef out) to `RegistryStore` (the durable row): write the bytes,
 * then record the archiveRef + retentionUntil on the row, then transition
 * DRAFT -> ORIGINAL. If the archive write itself throws (including the
 * mandatory-retentionUntil check), the registry row is untouched — a
 * failed archive attempt must never leave a row claiming bytes exist that
 * don't. Delivery, fan-out and rule determination are NOT here — this is
 * archive-only, per the task that produced this file.
 */
import type { ArchiveStore } from './archive-store.js';
import type { RegistryStore } from '../registry/registry-store.js';

export type { ArchiveInput, ArchiveStore } from './archive-store.js';
export { assertValidRetentionUntil } from './archive-store.js';
export { FsArchiveStore } from './fs-archive-store.js';
export { S3ArchiveStore } from './s3-archive-store.js';
export type { S3ArchiveStoreOptions, S3ClientLike } from './s3-archive-store.js';

export interface ArchiveArtifactInput {
  archiveStore: ArchiveStore;
  registryStore: RegistryStore;
  docId: string;
  bytes: Uint8Array;
  mediaType: string;
  /** RFC 3339 timestamp. Mandatory — validated by `archiveStore.archive`
   * before any bytes are written. */
  retentionUntil: string;
}

/**
 * Archive an artifact's bytes and update its registry row to match:
 * archiveRef set, state DRAFT -> ORIGINAL. Returns the archiveRef.
 * Throws (without touching the registry row) if the underlying archive
 * write fails for any reason, including a missing/invalid retentionUntil.
 */
export async function archiveArtifact(input: ArchiveArtifactInput): Promise<string> {
  const archiveRef = await input.archiveStore.archive({
    bytes: input.bytes,
    mediaType: input.mediaType,
    retentionUntil: input.retentionUntil,
  });
  input.registryStore.updateArchiveRef(input.docId, archiveRef, input.retentionUntil);
  input.registryStore.updateState(input.docId, 'ORIGINAL');
  return archiveRef;
}
