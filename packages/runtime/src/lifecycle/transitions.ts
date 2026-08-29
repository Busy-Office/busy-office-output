/**
 * Template lifecycle transition table (ROADMAP Stage 5 task 1: "Template
 * lifecycle draft→review→approved→published→retired ... DoD: state machine
 * tests"; arb-chair ruling 2026-08-29). PURE — the table is data, the
 * evaluator does no I/O and reads no clock, so every edge and every
 * refusal is unit-testable without a store (transitions.test.ts).
 *
 * The six legal edges, exhaustive (anything else, including X→X, is
 * `illegal-transition`):
 *
 *   draft     → review     submit
 *   review    → draft      return
 *   review    → approved   approve   (+ separation of duties, below)
 *   approved  → draft      reopen
 *   approved  → published  publish   (the ONLY way to become live — the
 *                                     current state must be `approved`,
 *                                     which is what "publish blocked
 *                                     without approval record" rests on)
 *   published → retired    retire    (terminal)
 *
 * Transport (ruling (b)): there is ONE environment (ADR-009). `published`
 * IS production in it; `review` is the QAS analogue. No environment, no
 * promotion verb — the table above is the whole transport model.
 *
 * Every transition needs an `Actor` WITH a `subjectId` (refusal
 * `actor-required`; the `Actor` type is reused unchanged from
 * authorization-port.ts, its optional `subjectId` made mandatory here at
 * runtime) and a non-blank `reason` (refusal `reason-required`) — the
 * ROADMAP's "author/reviewer/approver/reason recorded".
 *
 * Separation of duties (ruling (d), maintainer-confirmed): on
 * review → approved the approver's `subjectId` must differ from the
 * `subjectId` on the MOST RECENT draft → review row of the key's history
 * (refusal `separation-of-duties`). No other pairing is checked.
 *
 * ADR-005 is honoured structurally: an AI-patched template enters as
 * `draft` (its declared initial state) and must travel this table like
 * any other — nothing here knows or cares about provenance.
 */
import type { TemplateLifecycle } from '@busy-office/output-schema';
import type { Actor } from '../authorization/authorization-port.js';
import type { TemplateLifecycleEvent } from '../registry/registry-store.js';

/**
 * The state list is DERIVED from an object that `satisfies
 * Record<TemplateLifecycle, true>` (GAP-21): a union member missing here is
 * a compile error (missing property), and a key that is not a union member
 * is a compile error (excess property). Adding a state to the schema union
 * therefore cannot compile until this file — and with it the transition
 * table — is updated. Insertion order is the documented lifecycle order.
 */
const LIFECYCLE_STATE_SET = {
  draft: true,
  review: true,
  approved: true,
  published: true,
  retired: true,
} satisfies Record<TemplateLifecycle, true>;

export const LIFECYCLE_STATES: readonly TemplateLifecycle[] = Object.keys(
  LIFECYCLE_STATE_SET,
) as (keyof typeof LIFECYCLE_STATE_SET)[];

export type TransitionVerb = 'submit' | 'return' | 'approve' | 'reopen' | 'publish' | 'retire';

export interface LifecycleTransition {
  from: TemplateLifecycle;
  to: TemplateLifecycle;
  verb: TransitionVerb;
}

/** The table, as data. Exhaustive: an edge not listed here does not exist. */
export const LIFECYCLE_TRANSITIONS: readonly LifecycleTransition[] = [
  { from: 'draft', to: 'review', verb: 'submit' },
  { from: 'review', to: 'draft', verb: 'return' },
  { from: 'review', to: 'approved', verb: 'approve' },
  { from: 'approved', to: 'draft', verb: 'reopen' },
  { from: 'approved', to: 'published', verb: 'publish' },
  { from: 'published', to: 'retired', verb: 'retire' },
];

export type TransitionRefusal = 'actor-required' | 'reason-required' | 'illegal-transition' | 'separation-of-duties';

export type TransitionEvaluation = { ok: true; verb: TransitionVerb } | { ok: false; refused: TransitionRefusal };

/** True when `actor` carries a usable subjectId — the runtime-mandatory
 * half of the otherwise-unchanged `Actor` shape. */
export function hasSubjectId(actor: Actor): actor is Actor & { subjectId: string } {
  return typeof actor.subjectId === 'string' && actor.subjectId.trim() !== '';
}

/**
 * Evaluate one requested transition of a key currently in `current`.
 * Order: input refusals (`actor-required`, then `reason-required`) come
 * first — a caller with an incomplete request learns that before learning
 * whether the edge exists; then the table; then separation of duties.
 *
 * `history` is the key's full lifecycle log, oldest first — only the
 * approve edge reads it.
 */
export function evaluateTransition(
  current: TemplateLifecycle,
  to: TemplateLifecycle,
  actor: Actor,
  reason: string,
  history: readonly TemplateLifecycleEvent[],
): TransitionEvaluation {
  if (!hasSubjectId(actor)) return { ok: false, refused: 'actor-required' };
  if (typeof reason !== 'string' || reason.trim() === '') return { ok: false, refused: 'reason-required' };

  const edge = LIFECYCLE_TRANSITIONS.find((t) => t.from === current && t.to === to);
  if (edge === undefined) return { ok: false, refused: 'illegal-transition' };

  if (edge.verb === 'approve') {
    const lastSubmit = [...history].reverse().find((e) => e.fromState === 'draft' && e.toState === 'review');
    if (lastSubmit !== undefined && lastSubmit.actorSubjectId === actor.subjectId) {
      return { ok: false, refused: 'separation-of-duties' };
    }
  }

  return { ok: true, verb: edge.verb };
}
