/**
 * Archive module barrel + the registry-wiring orchestration. Archiving
 * without retention fails.
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
import type { Renderer } from '@busy-office/output-schema';
import type { ArchiveStore } from './archive-store.js';
import type { RegistryStore } from '../registry/registry-store.js';

export type { ArchiveInput, ArchiveStore } from './archive-store.js';
export { assertValidRetentionUntil } from './archive-store.js';
export { FsArchiveStore } from './fs-archive-store.js';
export { S3ArchiveStore } from './s3-archive-store.js';
export type { S3ArchiveStoreOptions, S3ClientLike } from './s3-archive-store.js';
export { retentionUntilFor, retentionYearsFor } from './retention-policy.js';
export { enforceRetention } from './retention-enforcement.js';
export type { RetentionEnforcementDeps, RetentionPurgeResult } from './retention-enforcement.js';

export interface ArchiveArtifactInput {
  archiveStore: ArchiveStore;
  registryStore: RegistryStore;
  docId: string;
  bytes: Uint8Array;
  mediaType: string;
  /** RFC 3339 timestamp. Mandatory — validated by `archiveStore.archive`
   * before any bytes are written. */
  retentionUntil: string;
  /** The renderer that produced `bytes` (HLD §3 "template+renderer
   * versions" on the audit row). Persisted as `id@version` in the same
   * registry write that sets archiveRef, so a row is never
   * archived-but-renderer-unknown. */
  renderer: Pick<Renderer, 'id' | 'version'>;
}

/** The registry's `rendererVersion` wire format: `<rendererId>@<version>`,
 * e.g. `typst@0.15.1` / `pdf-direct@1.17.1` — the same shape the console's
 * `template@ver · renderer@ver` line displays. */
export function rendererVersionString(renderer: Pick<Renderer, 'id' | 'version'>): string {
  if (typeof renderer.id !== 'string' || renderer.id.trim() === '') {
    throw new TypeError('archiveArtifact requires a renderer with a non-empty id.');
  }
  if (typeof renderer.version !== 'string' || renderer.version.trim() === '') {
    throw new TypeError(`archiveArtifact requires a non-empty version for renderer '${renderer.id}'.`);
  }
  return `${renderer.id}@${renderer.version}`;
}

/**
 * Archive an artifact's bytes and update its registry row to match:
 * archiveRef + rendererVersion set, state DRAFT -> ORIGINAL. Returns the
 * archiveRef. Throws (without touching the registry row) if the underlying
 * archive write fails for any reason, including a missing/invalid
 * retentionUntil or an unidentifiable renderer.
 */
export async function archiveArtifact(input: ArchiveArtifactInput): Promise<string> {
  // Validate before writing bytes: a bad renderer identity must not leave
  // orphaned archive bytes behind, same as a bad retentionUntil.
  const rendererVersion = rendererVersionString(input.renderer);
  const archiveRef = await input.archiveStore.archive({
    bytes: input.bytes,
    mediaType: input.mediaType,
    retentionUntil: input.retentionUntil,
  });
  input.registryStore.updateArchiveRef(input.docId, archiveRef, input.retentionUntil, rendererVersion);
  input.registryStore.updateState(input.docId, 'ORIGINAL');
  return archiveRef;
}
