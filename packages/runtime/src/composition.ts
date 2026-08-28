/**
 * Composition + render + archive + enqueue (ROADMAP Stage 3, "Single-process
 * serve" task) — the step HLD §2's pipeline diagram calls Composition,
 * Rendering, and Archive, wired per-resolution after determination succeeds
 * (server.ts's `handleEvent`). Scope per the arb-chair ruling this task
 * follows exactly: exactly one resolved template (`po-global-v1`) has real
 * content (`render/template-content.ts`); every other resolved template is
 * determination-only for now, and this module says so honestly instead of
 * crashing or fabricating output.
 *
 * Delivery failure never re-renders (CLAUDE.md/docs/POLICY.md): this module
 * only ever calls `deliveryQueue.enqueue`, which inserts a `pending` job —
 * the actual send/retry/poison machinery (delivery-queue.ts,
 * sqlite-delivery-queue.ts) reads bytes back from the archive, never from
 * here again.
 */
import type { DataContractEnvelope, Renderer } from '@busy-office/output-schema';
import { mergePdfs } from '@busy-office/render-typst';
import type { RegistryStore } from './registry/registry-store.js';
import type { ArchiveStore } from './archive/archive-store.js';
import { archiveArtifact } from './archive/index.js';
import type { DeliveryQueue } from './delivery/delivery-queue.js';
import type { Resolution } from './determination/index.js';
import { getTemplateContent } from './render/template-content.js';
import { renderCoverSheet } from './render/cover-sheet.js';

export interface CompositionDeps {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
  deliveryQueue: DeliveryQueue;
  renderer: Renderer;
  /** Returns an RFC 3339 timestamp for a freshly-archived artifact's
   * mandatory retentionUntil. Defaults to `defaultRetentionUntil` below.
   * Injectable so tests can assert an exact value without depending on
   * wall-clock time. */
  retentionUntil?: () => string;
}

export type CompositionOutcome =
  | { outcome: 'rendered'; archiveRef: string; retentionUntil: string; deliveryJobId: number }
  | { outcome: 'no-template-content'; templateId: string }
  | { outcome: 'render-failed'; templateId: string; error: string };

/**
 * Retention-until stand-in (ROADMAP Stage 3 scope boundary: "a fixed
 * default retentionUntil for this task's rendered artifacts is enough" —
 * per-doc-type retention *policy* is explicitly ROADMAP Stage 4's "Retention
 * per doc type enforced end-to-end", not built here). Ten years from archive
 * time: long enough to be a plausible stand-in for every document type this
 * task can actually render content for (purchase orders only, per the
 * arb-chair ruling), short enough not to read as a real regulatory
 * decision. This is a reasonable placeholder, not a policy call — replace
 * per-document-type once Stage 4 lands.
 */
const DEFAULT_RETENTION_YEARS = 10;

export function defaultRetentionUntil(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + DEFAULT_RETENTION_YEARS);
  return d.toISOString();
}

/**
 * Render (if content exists for `resolution.templateId`), archive, and
 * enqueue delivery for one resolution. Never throws: a render/archive/
 * enqueue failure comes back as a `'render-failed'` outcome so one bad
 * resolution in a fan-out set never crashes the whole ingress request
 * (determination + idempotency already succeeded and already minted this
 * docId by the time this runs).
 */
export async function composeRenderArchiveAndEnqueue(
  deps: CompositionDeps,
  docId: string,
  resolution: Resolution,
  data: DataContractEnvelope,
): Promise<CompositionOutcome> {
  const docNode = getTemplateContent(resolution.templateId);
  if (docNode === undefined) {
    return { outcome: 'no-template-content', templateId: resolution.templateId };
  }

  try {
    const artifact = await deps.renderer.render({
      kind: 'ir',
      ir: { irVersion: '1', root: docNode, data },
    });

    const retentionUntil = (deps.retentionUntil ?? defaultRetentionUntil)();
    const archiveRef = await archiveArtifact({
      archiveStore: deps.archiveStore,
      registryStore: deps.registryStore,
      docId,
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
      retentionUntil,
    });

    const job = deps.deliveryQueue.enqueue({
      docId,
      channel: resolution.channel,
      recipients: resolution.recipients,
    });

    return { outcome: 'rendered', archiveRef, retentionUntil, deliveryJobId: job.id };
  } catch (err) {
    return {
      outcome: 'render-failed',
      templateId: resolution.templateId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Render + PAGE-MERGE + archive + enqueue for one resolution (ROADMAP
 * Stage 4, "PDF attachment concatenation" — DoD: "merged artifact archived
 * as one document, page counts asserted"). A separate, opt-in entry point
 * next to `composeRenderArchiveAndEnqueue`, not a change to its default
 * behavior: concatenation is not wired as every document's default
 * path — it is document-type/business-decision-specific which resolved
 * templates should ship with a cover sheet and/or appended T&Cs, and no
 * such per-template signal exists yet (that's a future, narrower task —
 * see this task's report). This function proves the mechanism end-to-end
 * for a caller that opts in: cover sheet (render/cover-sheet.ts) + the
 * main rendered document + a terms-and-conditions PDF (caller-supplied
 * bytes — see test/fixtures/terms-and-conditions.pdf for the fixture used
 * in this task's own test) are merged page-for-page (render-typst's
 * `mergePdfs`, which also re-attaches PDF/A-2b `/OutputIntents` +
 * `/Metadata` so the merge stays compliant) into ONE PDF, archived as ONE
 * registry row/artifact — never three.
 *
 * Same "never throws" contract as `composeRenderArchiveAndEnqueue`: any
 * failure (no template content, render, merge, or archive) comes back as
 * a `CompositionOutcome`, not a thrown error.
 */
export async function composeConcatenatedRenderArchiveAndEnqueue(
  deps: CompositionDeps,
  docId: string,
  resolution: Resolution,
  data: DataContractEnvelope,
  termsAndConditionsBytes: Uint8Array,
): Promise<CompositionOutcome> {
  const docNode = getTemplateContent(resolution.templateId);
  if (docNode === undefined) {
    return { outcome: 'no-template-content', templateId: resolution.templateId };
  }

  try {
    const [coverBytes, mainArtifact] = await Promise.all([
      renderCoverSheet(deps.renderer, docId),
      deps.renderer.render({ kind: 'ir', ir: { irVersion: '1', root: docNode, data } }),
    ]);

    const mergedBytes = await mergePdfs([coverBytes, mainArtifact.bytes, termsAndConditionsBytes]);

    const retentionUntil = (deps.retentionUntil ?? defaultRetentionUntil)();
    const archiveRef = await archiveArtifact({
      archiveStore: deps.archiveStore,
      registryStore: deps.registryStore,
      docId,
      bytes: mergedBytes,
      mediaType: mainArtifact.mediaType,
      retentionUntil,
    });

    const job = deps.deliveryQueue.enqueue({
      docId,
      channel: resolution.channel,
      recipients: resolution.recipients,
    });

    return { outcome: 'rendered', archiveRef, retentionUntil, deliveryJobId: job.id };
  } catch (err) {
    return {
      outcome: 'render-failed',
      templateId: resolution.templateId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One `resumeStrandedCompositions` result: which docId, and what running
 * (or skipping) composition for it produced. `skipped: true` means the
 * archive write had already completed before the crash — the outbox row
 * itself just hadn't been cleared yet; re-running composition would have
 * archived a second, orphaned copy of the same artifact, so it wasn't. */
export type ResumeOutcome =
  | { docId: string; skipped: false; outcome: CompositionOutcome }
  | { docId: string; skipped: true };

/**
 * Redrive every still-pending `composition_outbox` row (ROADMAP Stage 3
 * "Embeddable module ... transactional outbox" — see
 * migrations/0005_add_composition_outbox.sql for the full rationale).
 *
 * A pending outbox row means `mintWithOutbox` committed a docId but
 * `composeRenderArchiveAndEnqueue` never ran to completion for it — either
 * it is still genuinely in flight elsewhere in this process, or the
 * process crashed between mint and composition-complete. This function is
 * meant to be called after a restart (or on a timer), once whatever else
 * might still be legitimately in flight has had time to finish —
 * `minAgeMs` (default 0) lets a caller skip rows younger than that.
 *
 * Never re-renders/re-archives a docId whose archiveRef is already set
 * (`skipped: true`): composeRenderArchiveAndEnqueue's own archive step
 * already succeeded before the crash, so only the outbox row's own
 * deletion was interrupted — running composition again would silently
 * produce a second, unreferenced copy of the same artifact bytes, exactly
 * the orphan this mechanism exists to prevent. Every entry, redriven or
 * skipped, has its outbox row cleared before this returns.
 */
export async function resumeStrandedCompositions(
  deps: CompositionDeps,
  minAgeMs = 0,
): Promise<ResumeOutcome[]> {
  const results: ResumeOutcome[] = [];
  for (const entry of deps.registryStore.listOutboxEntries()) {
    const ageMs = Date.now() - Date.parse(entry.createdAt);
    if (Number.isFinite(ageMs) && ageMs < minAgeMs) continue;

    const row = deps.registryStore.getByDocId(entry.docId);
    if (row?.archiveRef) {
      deps.registryStore.clearOutboxEntry(entry.docId);
      results.push({ docId: entry.docId, skipped: true });
      continue;
    }

    const resolution = entry.resolution as Resolution;
    const data = entry.data as DataContractEnvelope;
    const outcome = await composeRenderArchiveAndEnqueue(deps, entry.docId, resolution, data);
    deps.registryStore.clearOutboxEntry(entry.docId);
    results.push({ docId: entry.docId, skipped: false, outcome });
  }
  return results;
}
