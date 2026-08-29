/**
 * Template lifecycle transition table (ROADMAP Stage 5 task 1 — "DoD:
 * state machine tests"). Pure: no store, no clock. Every legal edge, every
 * illegal (from, to) pair including X→X, the two input refusals, and
 * separation of duties on review→approved.
 */
import { describe, expect, it } from 'vitest';
import type { TemplateLifecycle } from '@busy-office/output-schema';
import type { TemplateLifecycleEvent } from '../registry/registry-store.js';
import { LIFECYCLE_STATES, LIFECYCLE_TRANSITIONS, evaluateTransition } from './transitions.js';

const alice = { role: 'author', subjectId: 'alice' };
const bob = { role: 'reviewer', subjectId: 'bob' };

function row(fromState: TemplateLifecycle | null, toState: TemplateLifecycle, subjectId: string): TemplateLifecycleEvent {
  return { templateId: 't', version: '1', fromState, toState, actorRole: 'x', actorSubjectId: subjectId, reason: 'r', occurredAt: '2026-08-29T00:00:00.000Z' };
}

describe('transition table — the six legal edges', () => {
  it.each([
    ['draft', 'review', 'submit'],
    ['review', 'draft', 'return'],
    ['review', 'approved', 'approve'],
    ['approved', 'draft', 'reopen'],
    ['approved', 'published', 'publish'],
    ['published', 'retired', 'retire'],
  ] as const)('%s → %s is legal (%s)', (from, to, verb) => {
    expect(evaluateTransition(from, to, bob, 'because', [])).toEqual({ ok: true, verb });
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

  it('no pairing other than submit/approve is checked: the approver may publish', () => {
    const history = [row(null, 'draft', 'registration'), row('draft', 'review', 'alice'), row('review', 'approved', 'bob')];
    expect(evaluateTransition('approved', 'published', bob, 'go', history)).toEqual({ ok: true, verb: 'publish' });
  });
});
