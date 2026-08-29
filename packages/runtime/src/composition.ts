/**
 * Composition + render + archive + enqueue (ROADMAP Stage 3, "Single-process
 * serve" task) — the step HLD §2's pipeline diagram calls Composition,
 * Rendering, and Archive, wired per-resolution after determination succeeds
 * (`OutputPort.emit`, embed/create-output.ts). Template CONTENT comes from
 * the `DocumentTypeRegistry` on `CompositionDeps.documentTypes` (GAP-08:
 * the engine holds no template tree of its own — `registerDocumentType`
 * is how content gets here); a resolved template with no registered
 * content composes to an honest `'no-template-content'` outcome, never a
 * crash and never fabricated output.
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
import { retentionUntilFor } from './archive/retention-policy.js';
import type { DeliveryQueue } from './delivery/delivery-queue.js';
import type { Resolution } from './determination/index.js';
import type { DocumentTypeRegistry } from './registration/document-type-registry.js';
import { renderCoverSheet } from './render/cover-sheet.js';
import { renderMessage, type RenderedMessage } from './message/message-template.js';

/**
 * GAP-10: evaluate the resolution's message template (resolved at
 * determination by ID) against the payload — ONCE, here, before render,
 * so the rendered subject/body ride on the delivery job and the sender
 * never re-reads the payload. `undefined` for a resolution whose channel
 * carries no message. A resolved ID with no registered template, or an
 * expression that yields a non-scalar, throws inside the callers'
 * try/catch (→ `'render-failed'`, before anything is archived) — by
 * template/expression name, never by value.
 */
function renderResolutionMessage(
  deps: Pick<CompositionDeps, 'documentTypes'>,
  resolution: Pick<Resolution, 'messageTemplateId'>,
  data: DataContractEnvelope,
): RenderedMessage | undefined {
  if (resolution.messageTemplateId === undefined) return undefined;
  const template = deps.documentTypes.messageTemplate(resolution.messageTemplateId);
  if (template === undefined) {
    throw new Error(`message template '${resolution.messageTemplateId}' resolved at determination but is not registered`);
  }
  return renderMessage(template, data);
}

export interface CompositionDeps {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
  deliveryQueue: DeliveryQueue;
  /** Where template content comes from (GAP-08): the registry every
   * `registerDocumentType` call fills. Composition looks up
   * `resolution.templateId` here and nowhere else. */
  documentTypes: DocumentTypeRegistry;
  /** The default renderer — used when a resolution carries no `renderer`
   * id (outbox rows minted before that field existed, older test
   * fixtures) and as the entry for its own `id` in the registry. */
  renderer: Renderer;
  /** Renderer registry keyed by `Renderer.id` (ADR-002: pdf-direct as a
   * second renderer; renderer selection is a TEMPLATE property —
   * `TemplateMeta.renderer` → `Resolution.renderer` → this lookup). A
   * resolution naming an id that is neither here nor `renderer.id` is a
   * `'render-failed'` outcome with a clear message, never a silent
   * fallback to the default: rendering a template that declared
   * `"pdf-direct"` through Typst would be a wrong artifact archived
   * "successfully". */
  renderers?: Readonly<Record<string, Renderer>>;
  /** Returns an RFC 3339 timestamp for a freshly-archived artifact's
   * mandatory retentionUntil, given the resolved `documentType`. Defaults
   * to `retentionUntilFor` (archive/retention-policy.ts) — the
   * per-document-type policy. Injectable so tests can assert an exact
   * value without depending on wall-clock time or the real policy table. */
  retentionUntil?: (documentType: string) => string;
}

export type CompositionOutcome =
  | { outcome: 'rendered'; archiveRef: string; retentionUntil: string; deliveryJobId: number }
  | { outcome: 'no-template-content'; templateId: string }
  | { outcome: 'render-failed'; templateId: string; error: string };

/**
 * The routing decision point (ADR-002 task: "routing rule decided in this
 * task"): which `Renderer` implementation serves `resolution`. The rule
 * itself lives in the template (`TemplateMeta.renderer`, e.g.
 * packages/runtime/rules/templates/payslip-companyCode-1000.json says
 * `"pdf-direct"`); this function only honours it. Throws — inside the
 * callers' try/catch, so it surfaces as `'render-failed'` — when the id is
 * unknown, rather than substituting the default.
 */
export function selectRenderer(deps: CompositionDeps, resolution: Pick<Resolution, 'renderer' | 'templateId'>): Renderer {
  const id = resolution.renderer;
  if (id === undefined) return deps.renderer;
  // The default renderer serves its own id ahead of the registry: a caller
  // that swaps `deps.renderer` (tests wrap it to simulate a hang/crash —
  // serve-crash-resume.test.ts) must see that swap honoured for every
  // template on that renderer, not bypassed via a registry entry.
  if (deps.renderer.id === id) return deps.renderer;
  const fromRegistry = deps.renderers?.[id];
  if (fromRegistry !== undefined) return fromRegistry;
  throw new Error(
    `template '${resolution.templateId}' declares renderer '${id}', but no renderer with that id is registered (have: ${[
      deps.renderer.id,
      ...Object.keys(deps.renderers ?? {}),
    ].join(', ')})`,
  );
}

/**
 * Retention-until, per document type (ROADMAP Stage 4, "Retention per doc
 * type enforced end-to-end"). This used to be a single fixed 10-year
 * stand-in (ROADMAP Stage 3 scope boundary) applied to every document
 * type alike; it now defers to `retentionUntilFor`
 * (archive/retention-policy.ts), which genuinely varies by
 * `documentType` — see that module for the periods chosen and why they
 * are not a real legal/regulatory decision.
 */
export function defaultRetentionUntil(documentType: string): string {
  return retentionUntilFor(documentType);
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
  const docNode = deps.documentTypes.templateContent(resolution.templateId);
  if (docNode === undefined) {
    return { outcome: 'no-template-content', templateId: resolution.templateId };
  }

  try {
    const message = renderResolutionMessage(deps, resolution, data);
    const renderer = selectRenderer(deps, resolution);
    const artifact = await renderer.render({
      kind: 'ir',
      ir: { irVersion: '1', root: docNode, data },
    });

    const retentionUntil = (deps.retentionUntil ?? defaultRetentionUntil)(data.documentType);
    const archiveRef = await archiveArtifact({
      archiveStore: deps.archiveStore,
      registryStore: deps.registryStore,
      docId,
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
      retentionUntil,
      renderer,
    });

    const job = deps.deliveryQueue.enqueue({
      docId,
      channel: resolution.channel,
      recipients: resolution.recipients,
      ...(message !== undefined ? { message } : {}),
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
  const docNode = deps.documentTypes.templateContent(resolution.templateId);
  if (docNode === undefined) {
    return { outcome: 'no-template-content', templateId: resolution.templateId };
  }

  try {
    const message = renderResolutionMessage(deps, resolution, data);
    const renderer = selectRenderer(deps, resolution);
    const [coverBytes, mainArtifact] = await Promise.all([
      renderCoverSheet(renderer, docId),
      renderer.render({ kind: 'ir', ir: { irVersion: '1', root: docNode, data } }),
    ]);

    const mergedBytes = await mergePdfs([coverBytes, mainArtifact.bytes, termsAndConditionsBytes]);

    const retentionUntil = (deps.retentionUntil ?? defaultRetentionUntil)(data.documentType);
    const archiveRef = await archiveArtifact({
      archiveStore: deps.archiveStore,
      registryStore: deps.registryStore,
      docId,
      bytes: mergedBytes,
      mediaType: mainArtifact.mediaType,
      retentionUntil,
      // The merged PDF's page content came from this renderer; the merge
      // itself is a page-level concatenation, not a second rendering.
      renderer,
    });

    const job = deps.deliveryQueue.enqueue({
      docId,
      channel: resolution.channel,
      recipients: resolution.recipients,
      ...(message !== undefined ? { message } : {}),
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
