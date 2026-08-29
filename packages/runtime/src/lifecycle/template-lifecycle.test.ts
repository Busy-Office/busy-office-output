/**
 * Store-backed template lifecycle (ROADMAP Stage 5 task 1 — "DoD: state
 * machine tests"). Against a real `:memory:` SqliteRegistryStore:
 *  - each legal transition appends exactly one row with every audit field;
 *  - refusals append nothing (table, reason, actor, separation of duties);
 *  - seeding: one row per key on registration, document AND message
 *    templates; a second process registering the same definition does
 *    not re-seed; the store wins over a drifted declaration;
 *  - history order, current = last row, unknown key = undefined;
 *  - a transition never mutates the DocumentTypeRegistry's maps.
 */
import { describe, expect, it } from 'vitest';
import type { TemplateLifecycle, TemplateMeta } from '@busy-office/output-schema';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import { createDocumentTypeRegistry } from '../registration/document-type-registry.js';
import type { DocumentTypeDefinition } from '../registration/document-type-definition.js';
import { createOutput } from '../embed/create-output.js';
import { createTemplateLifecycle, REGISTRATION_ACTOR_ROLE, REGISTRATION_SEED_REASON } from './template-lifecycle.js';

const alice = { role: 'author', subjectId: 'alice' };
const bob = { role: 'reviewer', subjectId: 'bob' };
const carol = { role: 'approver', subjectId: 'carol' };
const KEY = { templateId: 'memo-v1', version: '1.0.0' };

function meta(id: string, lifecycle: TemplateLifecycle, version = '1.0.0'): TemplateMeta {
  return { id, variant: { documentType: 'memo' }, version, lifecycle, renderer: 'typst' };
}

function memoDefinition(lifecycle: TemplateLifecycle = 'draft'): DocumentTypeDefinition {
  return {
    documentType: 'memo',
    contract: { type: 'object' },
    templates: [{ meta: meta('memo-v1', lifecycle) }],
    rules: [{ id: 'memo-rule', conditions: { documentType: 'memo' }, resolution: { channel: 'email', recipients: ['a@example.com'] } }],
    messageTemplates: [
      { meta: { id: 'memo-email-v1', variant: { documentType: 'memo' }, version: '1.0.0', lifecycle: 'published' }, channel: 'email', subject: ['Memo'], body: ['Attached.'] },
    ],
  };
}

/** A fresh store + lifecycle service with `memo-v1` seeded at `at`. */
function seeded(at: TemplateLifecycle = 'draft', clock?: () => string) {
  const store = createSqliteRegistryStore(':memory:');
  const lifecycle = createTemplateLifecycle(store, clock);
  lifecycle.seedFromRegistration('memo', [meta('memo-v1', at)]);
  return { store, lifecycle };
}

describe('legal transitions append exactly one audit row each', () => {
  it('draft → review → approved → published → retired, one row per step with every audit field', () => {
    let tick = 0;
    const { lifecycle } = seeded('draft', () => `2026-08-29T00:00:0${tick++}.000Z`);

    expect(lifecycle.transition(KEY, 'review', alice, 'ready for review')).toMatchObject({ status: 'transitioned', verb: 'submit' });
    expect(lifecycle.transition(KEY, 'approved', bob, 'reviewed, looks right')).toMatchObject({ status: 'transitioned', verb: 'approve' });
    expect(lifecycle.transition(KEY, 'published', carol, 'go live')).toMatchObject({ status: 'transitioned', verb: 'publish' });
    expect(lifecycle.transition(KEY, 'retired', carol, 'superseded by v2')).toMatchObject({ status: 'transitioned', verb: 'retire' });

    const history = lifecycle.history(KEY);
    expect(history).toHaveLength(5);
    expect(history[0]).toEqual({
      templateId: 'memo-v1', version: '1.0.0', fromState: null, toState: 'draft',
      actorRole: REGISTRATION_ACTOR_ROLE, actorSubjectId: 'definition:memo', reason: REGISTRATION_SEED_REASON, occurredAt: '2026-08-29T00:00:00.000Z',
    });
    expect(history.slice(1)).toEqual([
      { templateId: 'memo-v1', version: '1.0.0', fromState: 'draft', toState: 'review', actorRole: 'author', actorSubjectId: 'alice', reason: 'ready for review', occurredAt: '2026-08-29T00:00:01.000Z' },
      { templateId: 'memo-v1', version: '1.0.0', fromState: 'review', toState: 'approved', actorRole: 'reviewer', actorSubjectId: 'bob', reason: 'reviewed, looks right', occurredAt: '2026-08-29T00:00:02.000Z' },
      { templateId: 'memo-v1', version: '1.0.0', fromState: 'approved', toState: 'published', actorRole: 'approver', actorSubjectId: 'carol', reason: 'go live', occurredAt: '2026-08-29T00:00:03.000Z' },
      { templateId: 'memo-v1', version: '1.0.0', fromState: 'published', toState: 'retired', actorRole: 'approver', actorSubjectId: 'carol', reason: 'superseded by v2', occurredAt: '2026-08-29T00:00:04.000Z' },
    ]);
    expect(lifecycle.current(KEY)).toBe('retired');
  });

  it('review → draft (return) and approved → draft (reopen) each append one row', () => {
    const { lifecycle } = seeded('draft');
    lifecycle.transition(KEY, 'review', alice, 'submit');
    expect(lifecycle.transition(KEY, 'draft', bob, 'needs the footer fixed')).toMatchObject({ status: 'transitioned', verb: 'return' });
    expect(lifecycle.current(KEY)).toBe('draft');
    lifecycle.transition(KEY, 'review', alice, 'fixed');
    lifecycle.transition(KEY, 'approved', bob, 'ok');
    expect(lifecycle.transition(KEY, 'draft', carol, 'legal wording changed')).toMatchObject({ status: 'transitioned', verb: 'reopen' });
    expect(lifecycle.current(KEY)).toBe('draft');
    expect(lifecycle.history(KEY).map((e) => `${e.fromState}→${e.toState}`)).toEqual([
      'null→draft', 'draft→review', 'review→draft', 'draft→review', 'review→approved', 'approved→draft',
    ]);
  });
});

describe('refusals append nothing', () => {
  it.each([
    ['draft', 'approved'], ['draft', 'published'], ['draft', 'retired'], ['draft', 'draft'],
    ['review', 'published'], ['review', 'review'],
    ['approved', 'review'], ['approved', 'approved'],
    ['published', 'draft'], ['published', 'review'], ['published', 'approved'], ['published', 'published'],
    ['retired', 'draft'], ['retired', 'review'], ['retired', 'approved'], ['retired', 'published'], ['retired', 'retired'],
  ] as const)('%s → %s is illegal-transition and leaves the log unchanged', (from, to) => {
    const { lifecycle } = seeded(from);
    expect(lifecycle.transition(KEY, to, bob, 'try')).toEqual({ status: 'refused', refused: 'illegal-transition', current: from });
    expect(lifecycle.history(KEY)).toHaveLength(1);
    expect(lifecycle.current(KEY)).toBe(from);
  });

  it('blank or whitespace reason → reason-required, no row', () => {
    const { lifecycle } = seeded('draft');
    expect(lifecycle.transition(KEY, 'review', alice, '')).toEqual({ status: 'refused', refused: 'reason-required', current: 'draft' });
    expect(lifecycle.transition(KEY, 'review', alice, '   \n')).toEqual({ status: 'refused', refused: 'reason-required', current: 'draft' });
    expect(lifecycle.history(KEY)).toHaveLength(1);
  });

  it('actor without subjectId → actor-required, no row (Actor type unchanged, subjectId mandatory at runtime)', () => {
    const { lifecycle } = seeded('draft');
    expect(lifecycle.transition(KEY, 'review', { role: 'author' }, 'x')).toEqual({ status: 'refused', refused: 'actor-required', current: 'draft' });
    expect(lifecycle.transition(KEY, 'review', { role: 'author', subjectId: ' ' }, 'x')).toEqual({ status: 'refused', refused: 'actor-required', current: 'draft' });
    expect(lifecycle.history(KEY)).toHaveLength(1);
  });

  it('unknown key → unknown-template, no row', () => {
    const { lifecycle } = seeded('draft');
    expect(lifecycle.transition({ templateId: 'nope', version: '9' }, 'review', alice, 'x')).toEqual({ status: 'refused', refused: 'unknown-template' });
    expect(lifecycle.history({ templateId: 'nope', version: '9' })).toEqual([]);
  });
});

describe('separation of duties', () => {
  it('the submitter approving their own submission → separation-of-duties, no row', () => {
    const { lifecycle } = seeded('draft');
    lifecycle.transition(KEY, 'review', alice, 'submit');
    expect(lifecycle.transition(KEY, 'approved', alice, 'approving my own')).toEqual({ status: 'refused', refused: 'separation-of-duties', current: 'review' });
    expect(lifecycle.history(KEY)).toHaveLength(2);
  });

  it('a different subjectId approves fine', () => {
    const { lifecycle } = seeded('draft');
    lifecycle.transition(KEY, 'review', alice, 'submit');
    expect(lifecycle.transition(KEY, 'approved', bob, 'fine')).toMatchObject({ status: 'transitioned', verb: 'approve' });
  });

  it('after return + a new submit by B, A may approve', () => {
    const { lifecycle } = seeded('draft');
    lifecycle.transition(KEY, 'review', alice, 'submit');
    lifecycle.transition(KEY, 'draft', bob, 'return: typo');
    lifecycle.transition(KEY, 'review', bob, 'resubmit');
    expect(lifecycle.transition(KEY, 'approved', alice, 'fine')).toMatchObject({ status: 'transitioned', verb: 'approve' });
  });
});

describe('seeding from registration', () => {
  it('registerDocumentType seeds ONE row per templateId@version — document AND message templates', () => {
    const store = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore: store });
    expect(port.registerDocumentType(memoDefinition('draft')).status).toBe('registered');

    expect(store.listTemplateLifecycleHistory('memo-v1', '1.0.0')).toEqual([
      { templateId: 'memo-v1', version: '1.0.0', fromState: null, toState: 'draft', actorRole: 'registration', actorSubjectId: 'definition:memo', reason: REGISTRATION_SEED_REASON, occurredAt: expect.any(String) },
    ]);
    expect(store.listTemplateLifecycleHistory('memo-email-v1', '1.0.0')).toEqual([
      expect.objectContaining({ fromState: null, toState: 'published', actorRole: 'registration', actorSubjectId: 'definition:memo' }),
    ]);
  });

  it('a second store-backed process registering the same definition does NOT re-seed', () => {
    const store = createSqliteRegistryStore(':memory:');
    // "Process 1": its own registry + port over the shared store.
    expect(createOutput({ registryStore: store, documentTypes: createDocumentTypeRegistry() }).registerDocumentType(memoDefinition('draft')).status).toBe('registered');
    // "Process 2": a fresh registry (nothing registered yet) over the SAME store.
    expect(createOutput({ registryStore: store, documentTypes: createDocumentTypeRegistry() }).registerDocumentType(memoDefinition('draft')).status).toBe('registered');
    expect(store.listTemplateLifecycleHistory('memo-v1', '1.0.0')).toHaveLength(1);
    expect(store.listTemplateLifecycleHistory('memo-email-v1', '1.0.0')).toHaveLength(1);
  });

  it('the store wins over the declaration: a file declaring `published` against a retired row yields retired, registration still succeeds', () => {
    const store = createSqliteRegistryStore(':memory:');
    const lifecycle = createTemplateLifecycle(store);
    lifecycle.seedFromRegistration('memo', [meta('memo-v1', 'published')]);
    expect(lifecycle.transition(KEY, 'retired', carol, 'pulled')).toMatchObject({ status: 'transitioned' });

    const port = createOutput({ registryStore: store, documentTypes: createDocumentTypeRegistry() });
    const result = port.registerDocumentType(memoDefinition('published'));
    expect(result.status).toBe('registered');
    expect(lifecycle.current(KEY)).toBe('retired');
    expect(lifecycle.history(KEY)).toHaveLength(2); // seed + retire, nothing re-seeded
    expect(lifecycle.liveState([meta('memo-v1', 'published')])[0].lifecycle).toBe('retired');
  });

  it('seedFromRegistration reports seeded vs already-present', () => {
    const { lifecycle } = seeded('draft');
    expect(lifecycle.seedFromRegistration('memo', [meta('memo-v1', 'published'), meta('memo-v2', 'draft', '2.0.0')])).toEqual([
      { templateId: 'memo-v1', version: '1.0.0', seeded: false, current: 'draft' },
      { templateId: 'memo-v2', version: '2.0.0', seeded: true, current: 'draft' },
    ]);
  });
});

describe('reads', () => {
  it('history() is in order, current() is the last row, unknown key is undefined / []', () => {
    const { lifecycle } = seeded('draft');
    lifecycle.transition(KEY, 'review', alice, 'a');
    lifecycle.transition(KEY, 'draft', bob, 'b');
    expect(lifecycle.history(KEY).map((e) => e.toState)).toEqual(['draft', 'review', 'draft']);
    expect(lifecycle.current(KEY)).toBe('draft');
    expect(lifecycle.current({ templateId: 'memo-v1', version: '2.0.0' })).toBeUndefined();
    expect(lifecycle.history({ templateId: 'memo-v1', version: '2.0.0' })).toEqual([]);
  });

  it('liveState overlays the persisted state and falls back to the declared one for a key with no history', () => {
    const { lifecycle } = seeded('draft');
    lifecycle.transition(KEY, 'review', alice, 'a');
    const declared = [meta('memo-v1', 'published'), meta('memo-v9', 'approved', '9.0.0')];
    expect(lifecycle.liveState(declared).map((m) => m.lifecycle)).toEqual(['review', 'approved']);
    // Never mutates its input.
    expect(declared[0].lifecycle).toBe('published');
  });

  it('a transition never mutates the DocumentTypeRegistry maps', () => {
    const store = createSqliteRegistryStore(':memory:');
    const documentTypes = createDocumentTypeRegistry();
    const port = createOutput({ registryStore: store, documentTypes });
    port.registerDocumentType(memoDefinition('draft'));
    const before = JSON.stringify([documentTypes.templateMetas(), documentTypes.messageTemplateMetas()]);

    const lifecycle = createTemplateLifecycle(store);
    lifecycle.transition(KEY, 'review', alice, 'a');
    lifecycle.transition(KEY, 'approved', bob, 'b');
    lifecycle.transition(KEY, 'published', carol, 'c');

    expect(JSON.stringify([documentTypes.templateMetas(), documentTypes.messageTemplateMetas()])).toBe(before);
    expect(documentTypes.templateMeta('memo-v1')?.lifecycle).toBe('draft'); // declaration, untouched
    expect(lifecycle.current(KEY)).toBe('published'); // state, in the log
  });
});
