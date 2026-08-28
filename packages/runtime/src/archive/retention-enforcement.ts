/**
 * Retention enforcement (ROADMAP Stage 4, "Retention per doc type
 * enforced end-to-end" — DoD: "expiry test purges artifact, registry row
 * survives"). This is the piece nothing built before this task actually
 * did: `retentionUntil` was captured and validated
 * (archive/archive-store.ts's `assertValidRetentionUntil`) and stored
 * (the registry's `retention_until` column) but never ACTED on.
 *
 * `enforceRetention` is a single, directly-callable function — not a new
 * always-running background loop — mirroring `resumeStrandedCompositions`
 * (composition.ts) and `drainOnce` (worker.ts): both are plain functions a
 * timer or a future worker/cron calls, not timers themselves. A future
 * task can wire this into `startWorker`'s interval (worker.ts) or a
 * separate cron alongside it; this task's DoD only needs the function to
 * exist and be correct, driven directly by its own test (and, for now, by
 * whatever operator/cron calls it — CLAUDE.md: single-process mode is
 * sacred, and adding a second always-on interval to `serve()` for a task
 * that only needs to run, say, hourly is not obviously cheaper than
 * leaving it to be wired in deliberately later).
 *
 * Order of operations per expired artifact matters: purge the ARCHIVE
 * bytes first, then mark the registry row purged. If the process crashes
 * between those two steps, the row still shows `archiveRef` set and
 * `purgedAt` null — `listArchivedExpiring` will pick it back up on the
 * next run and retry the purge, which is safe because `ArchiveStore.purge`
 * is required to be idempotent (see archive-store.ts). The reverse order
 * (mark-then-purge) would risk a row claiming "purged" while the bytes
 * still exist on disk/in the bucket if the process died in between — the
 * chosen order can only ever "under-report" (bytes gone, row not yet
 * updated), never "over-report" (row says purged, bytes still there).
 */
import type { ArchiveStore } from './archive-store.js';
import type { RegistryStore } from '../registry/registry-store.js';

export interface RetentionEnforcementDeps {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
}

export type RetentionPurgeResult =
  | { docId: string; outcome: 'purged'; archiveRef: string; purgedAt: string }
  | { docId: string; outcome: 'purge-failed'; archiveRef: string; error: string };

/**
 * Purge every archived artifact whose `retentionUntil` is at or before
 * `now` (defaults to the real current time — RFC 3339, injectable so
 * tests can drive expiry deterministically without depending on
 * wall-clock time). For each: deletes the archived bytes via
 * `archiveStore.purge`, then records `purgedAt` on the registry row and
 * clears its `archiveRef` — the row itself is never deleted, and every
 * other field (`state`, `retentionUntil`, delivery history, ...) is left
 * exactly as it was, so the row alone still answers "this document
 * existed, was archived, and was purged on schedule."
 *
 * Never throws for one artifact's purge failure: a failing
 * `archiveStore.purge` call comes back as a `'purge-failed'` result (the
 * registry row is left untouched — still showing its `archiveRef`, so the
 * next run retries it) rather than aborting the whole batch, same
 * never-throws contract as `composeRenderArchiveAndEnqueue` /
 * `resumeStrandedCompositions` in composition.ts.
 */
export async function enforceRetention(
  deps: RetentionEnforcementDeps,
  now: string = new Date().toISOString(),
): Promise<RetentionPurgeResult[]> {
  const results: RetentionPurgeResult[] = [];
  for (const row of deps.registryStore.listArchivedExpiring(now)) {
    // listArchivedExpiring only returns rows with archiveRef set (its own
    // SQL filters archive_ref IS NOT NULL) — non-null here for TypeScript.
    const archiveRef = row.archiveRef as string;
    try {
      await deps.archiveStore.purge(archiveRef);
      const purgedAt = new Date().toISOString();
      deps.registryStore.markPurged(row.docId, purgedAt);
      results.push({ docId: row.docId, outcome: 'purged', archiveRef, purgedAt });
    } catch (err) {
      results.push({
        docId: row.docId,
        outcome: 'purge-failed',
        archiveRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
