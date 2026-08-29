/**
 * Template lifecycle transition table (ROADMAP Stage 5 task 1 — "DoD:
 * state machine tests"). Pure: no store, no clock. Every legal edge, every
 * illegal (from, to) pair including X→X, the two input refusals,
 * separation of duties on review→approved and approved→published, and the
 * approval record required on approved→published (Stage 5 task 3).
 */
import { describe, expect, it } from 'vitest';
import type { TemplateLifecycle } from '@busy-office/output-schema';
import type { TemplateLifecycleEvent } from '../registry/registry-store.js';
import { LIFECYCLE_STATES, LIFECYCLE_TRANSITIONS, evaluateTransition, standingApproval } from './transitions.js';

const alice = { role: 'author', subjectId: 'alice' };
const bob = { role: 'reviewer', subjectId: 'bob' };
const carol = { role: 'approver', subjectId: 'carol' };

function row(fromState: TemplateLifecycle | null, toState: TemplateLifecycle, subjectId: string): TemplateLifecycleEvent {
  return { templateId: 't', version: '1', fromState, toState, actorRole: 'x', actorSubjectId: subjectId, reason: 'r', occurredAt: '2026-08-29T00:00:00.000Z' };
}

/** A standing approval by bob on alice's submission — the minimum history
 * the publish edge accepts. */
const approvedByBob = [row(null, 'draft', 'registration'), row('draft', 'review', 'alice'), row('review', 'approved', 'bob')];

describe('transition table — the six legal edges', () => {
  it.each([
    ['draft', 'review', 'submit'],
    ['review', 'draft', 'return'],
    ['review', 'approved', 'approve'],
    ['approved', 'draft', 'reopen'],
    ['published', 'retired', 'retire'],
  ] as const)('%s → %s is legal (%s) with an empty history', (from, to, verb) => {
    expect(evaluateTransition(from, to, bob, 'because', [])).toEqual({ ok: true, verb });
  });

  it('approved → published is legal (publish) — given a standing approve row by someone else', () => {
    expect(evaluateTransition('approved', 'published', carol, 'because', approvedByBob)).toEqual({ ok: true, verb: 'publish' });
  });

  it('the table has exactly those six edges and nothing else', () => {
    expect(LIFECYCLE_TRANSITIONS.map((t) => `${t.from}→${t.to}`).sort()).toEqual(
      ['approved→draft', 'approved→published', 'draft→review', 'published→retired', 'review→approved', 'review→draft'].sort(),
    );
  });
});

describe('transition table — every other (from, to) pair is illegal-transition', () => {
  const legal = new Set(LIFECYCLE_TRANSITIONS.map((t) => `${t.from}→${t.to}`));
  const illegal: Array<[TemplateLifecycle, TemplateLifecycle]> = [];
  for (const from of LIFECYCLE_STATES) for (const to of LIFECYCLE_STATES) if (!legal.has(`${from}→${to}`)) illegal.push([from, to]);

  it('covers the pairs the ruling names explicitly', () => {
    const named = ['draft→approved', 'draft→published', 'review→published', 'published→draft', 'published→review', 'published→approved', 'retired→draft', 'retired→review', 'retired→approved', 'retired→published', 'approved→review', 'draft→retired', 'draft→draft', 'review→review', 'approved→approved', 'published→published', 'retired→retired'];
    const set = new Set(illegal.map(([f, t]) => `${f}→${t}`));
    for (const pair of named) expect(set.has(pair), pair).toBe(true);
    expect(illegal).toHaveLength(25 - 6);
  });

  it.each(illegal)('%s → %s is refused', (from, to) => {
    expect(evaluateTransition(from, to, bob, 'because', [])).toEqual({ ok: false, refused: 'illegal-transition' });
  });

  it('retired is terminal: no edge leaves it', () => {
    expect(LIFECYCLE_TRANSITIONS.some((t) => t.from === 'retired')).toBe(false);
  });
});

describe('input refusals', () => {
  it.each(['', '   ', '\n\t'])('reason %j → reason-required', (reason) => {
    expect(evaluateTransition('draft', 'review', alice, reason, [])).toEqual({ ok: false, refused: 'reason-required' });
  });

  it.each([{ role: 'author' }, { role: 'author', subjectId: '' }, { role: 'author', subjectId: '  ' }])('actor %j → actor-required', (actor) => {
    expect(evaluateTransition('draft', 'review', actor, 'because', [])).toEqual({ ok: false, refused: 'actor-required' });
  });

  it('input refusals come before the table: a missing reason on an illegal edge is still reason-required', () => {
    expect(evaluateTransition('draft', 'published', alice, '', [])).toEqual({ ok: false, refused: 'reason-required' });
  });
});

describe('separation of duties (review → approved)', () => {
  it('the submitter cannot approve their own submission', () => {
    const history = [row(null, 'draft', 'registration'), row('draft', 'review', 'alice')];
    expect(evaluateTransition('review', 'approved', alice, 'looks fine', history)).toEqual({ ok: false, refused: 'separation-of-duties' });
  });

  it('a different subjectId approves fine', () => {
    const history = [row(null, 'draft', 'registration'), row('draft', 'review', 'alice')];
    expect(evaluateTransition('review', 'approved', bob, 'looks fine', history)).toEqual({ ok: true, verb: 'approve' });
  });

  it('only the MOST RECENT submission counts: after a return and a re-submit by bob, alice may approve', () => {
    const history = [row(null, 'draft', 'registration'), row('draft', 'review', 'alice'), row('review', 'draft', 'bob'), row('draft', 'review', 'bob')];
    expect(evaluateTransition('review', 'approved', alice, 'ok', history)).toEqual({ ok: true, verb: 'approve' });
  });

  it('the submitter may publish (the submit/publish pairing is not checked)', () => {
    expect(evaluateTransition('approved', 'published', alice, 'go', approvedByBob)).toEqual({ ok: true, verb: 'publish' });
  });
});

describe('approval record required (approved → published) — the Stage 5 exit gate', () => {
  it('seeded straight to approved with an empty history → approval-record-required', () => {
    expect(evaluateTransition('approved', 'published', carol, 'go', [])).toEqual({ ok: false, refused: 'approval-record-required' });
  });

  it('seeded straight to approved (S1 seed row only) → approval-record-required: state alone is not an approval record', () => {
    expect(evaluateTransition('approved', 'published', carol, 'go', [row(null, 'approved', 'definition:memo')])).toEqual({ ok: false, refused: 'approval-record-required' });
  });

  it('submit → approve → publish is allowed', () => {
    expect(evaluateTransition('approved', 'published', carol, 'go', approvedByBob)).toEqual({ ok: true, verb: 'publish' });
  });

  it('approve → reopen → submit → approve again → publish is allowed (the second approve stands)', () => {
    const history = [...approvedByBob, row('approved', 'draft', 'alice'), row('draft', 'review', 'alice'), row('review', 'approved', 'bob')];
    expect(evaluateTransition('approved', 'published', carol, 'go', history)).toEqual({ ok: true, verb: 'publish' });
  });

  it('approve → reopen → publish is refused: the reopen invalidates the approve row', () => {
    // (The state would be `draft` in reality; the evaluator is asked as if
    // `approved` to prove the HISTORY check alone refuses it.)
    const history = [...approvedByBob, row('approved', 'draft', 'alice')];
    expect(evaluateTransition('approved', 'published', carol, 'go', history)).toEqual({ ok: false, refused: 'approval-record-required' });
    expect(standingApproval(history)).toBeUndefined();
  });

  it('approve → (later) return → publish is refused: any later row into draft invalidates', () => {
    const history = [...approvedByBob, row('review', 'draft', 'bob')];
    expect(evaluateTransition('approved', 'published', carol, 'go', history)).toEqual({ ok: false, refused: 'approval-record-required' });
  });

  it('publisher == standing approver → separation-of-duties', () => {
    expect(evaluateTransition('approved', 'published', bob, 'go', approvedByBob)).toEqual({ ok: false, refused: 'separation-of-duties' });
  });

  it('standingApproval returns the LAST approve row, byte-for-byte', () => {
    const second = row('review', 'approved', 'dave');
    const history = [...approvedByBob, row('approved', 'draft', 'alice'), row('draft', 'review', 'alice'), second];
    expect(standingApproval(history)).toBe(second);
    expect(standingApproval(approvedByBob)).toBe(approvedByBob[2]);
  });

  it('the approval check is on the edge, not the table: the edge table is unchanged (six edges, 19 illegal pairs)', () => {
    expect(LIFECYCLE_TRANSITIONS).toHaveLength(6);
    expect(LIFECYCLE_STATES.length ** 2 - LIFECYCLE_TRANSITIONS.length).toBe(19);
  });
});
