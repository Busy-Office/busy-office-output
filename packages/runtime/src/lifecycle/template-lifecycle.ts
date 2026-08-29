/**
 * Template lifecycle service (ROADMAP Stage 5 task 1; arb-chair ruling
 * 2026-08-29). State lives in the registry store's append-only
 * `template_lifecycle_log` (migrations/0012); the registered
 * `TemplateMeta.lifecycle` is only the DECLARED INITIAL state, seeded once.
 *
 *  - `seedFromRegistration`: for every `templateId@version` (document AND
 *    message templates) with no row yet, write ONE seed row `null → <declared>`
 *    by actor `{ role: 'registration', subjectId: 'definition:<documentType>' }`.
 *    A key that already has history is left alone — the STORE wins, the
 *    declaration is ignored, registration never fails on drift and never
 *    re-seeds. (Maintainer-confirmed "S1 seeding": a file declaring
 *    `published` seeds straight to `published` — git review governs files,
 *    ADR-003.)
 *  - `transition`: evaluate against the pure table (transitions.ts) using
 *    the key's current state + history, then append one audit row. A
 *    refusal appends nothing. A state change NEVER touches the
 *    `DocumentTypeRegistry` — the registry's maps are declaration; this log
 *    is state; `liveState` joins them at read time.
 *  - `liveState`: the metas with their CURRENT persisted lifecycle overlaid
 *    (falling back to the declared one for a key with no history — a
 *    registry filled without going through `registerDocumentType`). This is
 *    what `emit` hands to `determine()`, which admits only `published`
 *    candidates. `preview` does NOT go through here — previewing a draft is
 *    the point, and preview mints nothing.
 *
 * No auth transport, no sessions, no user directory, no role table: the
 * `Actor` is whatever the caller (a host, a future console screen) asserts.
 */
import type { TemplateLifecycle } from '@busy-office/output-schema';
import type { Actor } from '../authorization/authorization-port.js';
import type { RegistryStore, TemplateLifecycleEvent } from '../registry/registry-store.js';
import { evaluateTransition, type TransitionRefusal, type TransitionVerb } from './transitions.js';

export interface TemplateLifecycleKey {
  templateId: string;
  version: string;
}

/** The slice of `TemplateMeta` / `MessageTemplateMeta` this service reads. */
export interface LifecycleGovernedMeta {
  id: string;
  version: string;
  lifecycle: TemplateLifecycle;
}

export type TransitionResult =
  | { status: 'transitioned'; verb: TransitionVerb; event: TemplateLifecycleEvent }
  | { status: 'refused'; refused: TransitionRefusal | 'unknown-template'; current?: TemplateLifecycle };

export type SeedOutcome = { templateId: string; version: string; seeded: boolean; current: TemplateLifecycle };

export interface TemplateLifecycleService {
  seedFromRegistration(documentType: string, metas: readonly LifecycleGovernedMeta[]): SeedOutcome[];
  transition(key: TemplateLifecycleKey, to: TemplateLifecycle, actor: Actor, reason: string): TransitionResult;
  current(key: TemplateLifecycleKey): TemplateLifecycle | undefined;
  history(key: TemplateLifecycleKey): TemplateLifecycleEvent[];
  liveState<T extends LifecycleGovernedMeta>(metas: readonly T[]): T[];
}

export const REGISTRATION_ACTOR_ROLE = 'registration';
export const REGISTRATION_SEED_REASON = 'declared by document-type definition';

export function createTemplateLifecycle(
  registryStore: RegistryStore,
  clock: () => string = () => new Date().toISOString(),
): TemplateLifecycleService {
  return {
    seedFromRegistration(documentType, metas) {
      const out: SeedOutcome[] = [];
      for (const meta of metas) {
        const existing = registryStore.getTemplateLifecycle(meta.id, meta.version);
        if (existing !== undefined) {
          out.push({ templateId: meta.id, version: meta.version, seeded: false, current: existing });
          continue;
        }
        const seeded = registryStore.appendTemplateLifecycleEvent({
          templateId: meta.id,
          version: meta.version,
          fromState: null,
          toState: meta.lifecycle,
          actorRole: REGISTRATION_ACTOR_ROLE,
          actorSubjectId: `definition:${documentType}`,
          reason: REGISTRATION_SEED_REASON,
          occurredAt: clock(),
        });
        // `seeded === false` means another writer seeded this key between
        // our read and our append; the store's row wins, same as above.
        const current = seeded ? meta.lifecycle : (registryStore.getTemplateLifecycle(meta.id, meta.version) ?? meta.lifecycle);
        out.push({ templateId: meta.id, version: meta.version, seeded, current });
      }
      return out;
    },

    transition(key, to, actor, reason) {
      const current = registryStore.getTemplateLifecycle(key.templateId, key.version);
      if (current === undefined) return { status: 'refused', refused: 'unknown-template' };
      const history = registryStore.listTemplateLifecycleHistory(key.templateId, key.version);
      const evaluation = evaluateTransition(current, to, actor, reason, history);
      if (!evaluation.ok) return { status: 'refused', refused: evaluation.refused, current };
      const event: TemplateLifecycleEvent = {
        templateId: key.templateId,
        version: key.version,
        fromState: current,
        toState: to,
        actorRole: actor.role,
        // evaluateTransition already refused a missing subjectId.
        actorSubjectId: actor.subjectId as string,
        reason: reason.trim(),
        occurredAt: clock(),
      };
      if (!registryStore.appendTemplateLifecycleEvent(event)) {
        // The key moved between our read and the store's checked append.
        // Unreachable within one synchronous process; surfaced honestly
        // rather than retried, so the caller re-reads and decides again.
        throw new Error(`template lifecycle ${key.templateId}@${key.version} changed concurrently; re-read and retry`);
      }
      return { status: 'transitioned', verb: evaluation.verb, event };
    },

    current(key) {
      return registryStore.getTemplateLifecycle(key.templateId, key.version);
    },

    history(key) {
      return registryStore.listTemplateLifecycleHistory(key.templateId, key.version);
    },

    liveState(metas) {
      return metas.map((meta) => {
        const current = registryStore.getTemplateLifecycle(meta.id, meta.version);
        return current === undefined || current === meta.lifecycle ? meta : { ...meta, lifecycle: current };
      });
    },
  };
}
