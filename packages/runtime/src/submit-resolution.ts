/**
 * The ONE per-resolution mint -> compose -> clear-outbox step (GAP-11,
 * docs/GAP-REGISTER.md). Both ingress paths call this and nothing else:
 *   - `server.ts`'s `handleEvent` (the `serve()` HTTP path — the PRIMARY
 *     demo topology), and
 *   - `embed/create-output.ts`'s `submitEvent` (ADR-007 embedded module).
 *
 * Why one function: the two paths used to be two hand-copied versions of
 * the same critical section, and they drifted — the embedded module moved
 * onto the transactional outbox (`RegistryStore.mintWithOutbox`,
 * migrations/0005_add_composition_outbox.sql) while the HTTP path kept the
 * pre-outbox `getOrCreateByResolutionKey` mint. A crash mid-composition in
 * `serve` therefore stranded a permanently-DRAFT registry row with NO
 * outbox entry — invisible to `resumeStrandedCompositions` forever. Any
 * future change to the mint/compose contract now lands in exactly one place.
 *
 * Contract (unchanged from what create-output.ts already did):
 *   - First sighting: mint docId + outbox row atomically, run composition,
 *     clear the outbox row. A crash anywhere between mint and clear leaves
 *     the outbox row for `resumeStrandedCompositions` (composition.ts).
 *   - Replay: return the same docId; if a prior attempt's outbox row is
 *     still pending (it crashed), redrive composition inline rather than
 *     returning "replayed" for work that never finished.
 *   - `composition === undefined` (a bare `createIngressServer()` with no
 *     render/archive/queue backends — what most unit tests use): no
 *     composition work is owed, so no outbox row is written either — the
 *     plain `getOrCreateByResolutionKey` mint. An outbox row records work
 *     OWED; writing one that nothing will ever clear would be a lie that
 *     `resumeStrandedCompositions` would later "redrive" against backends
 *     that do not exist.
 */
import type { BusinessEventKey, DataContractEnvelope } from '@busy-office/output-schema';
import type { RegistryStore } from './registry/registry-store.js';
import type { Resolution } from './determination/index.js';
import { composeRenderArchiveAndEnqueue, type CompositionDeps, type CompositionOutcome } from './composition.js';

export interface SubmitResolutionOutcome {
  docId: string;
  /** true when this event+rule five-tuple was already seen (docId reused). */
  replayed: boolean;
  /**
   * `undefined` only when no `composition` deps were supplied (nothing to
   * compose). `{ outcome: 'replayed' }` when the docId already existed AND
   * its outbox work was already complete. Otherwise the real
   * `CompositionOutcome` — for a first sighting, or for a replay that found
   * and redrove a stranded outbox row.
   */
  composition: CompositionOutcome | { outcome: 'replayed' } | undefined;
}

export async function submitResolution(
  registryStore: RegistryStore,
  composition: CompositionDeps | undefined,
  businessEvent: BusinessEventKey,
  resolution: Resolution,
  data: DataContractEnvelope,
  documentType: string,
  ownerId: string | undefined,
): Promise<SubmitResolutionOutcome> {
  const key = { ...businessEvent, ruleId: resolution.ruleId };

  if (composition === undefined) {
    const { row, created } = registryStore.getOrCreateByResolutionKey(key, documentType, ownerId);
    return { docId: row.docId, replayed: !created, composition: undefined };
  }

  const { row, created } = registryStore.mintWithOutbox(key, resolution, data, documentType, ownerId);

  if (created) {
    const composed = await composeRenderArchiveAndEnqueue(composition, row.docId, resolution, data);
    registryStore.clearOutboxEntry(row.docId);
    return { docId: row.docId, replayed: false, composition: composed };
  }

  const pending = registryStore.getOutboxEntry(row.docId);
  if (pending !== undefined) {
    const composed = await composeRenderArchiveAndEnqueue(composition, row.docId, resolution, data);
    registryStore.clearOutboxEntry(row.docId);
    return { docId: row.docId, replayed: true, composition: composed };
  }
  return { docId: row.docId, replayed: true, composition: { outcome: 'replayed' } };
}
