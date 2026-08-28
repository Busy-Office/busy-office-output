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
import type { RegistryStore } from './registry/registry-store.js';
import type { ArchiveStore } from './archive/archive-store.js';
import { archiveArtifact } from './archive/index.js';
import type { DeliveryQueue } from './delivery/delivery-queue.js';
import type { Resolution } from './determination/index.js';
import { getTemplateContent } from './render/template-content.js';

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
