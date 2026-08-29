/**
 * STAGE 5 EXIT GATE (ROADMAP Stage 5 task 3 — "Publish blocked without
 * approval record — DoD: the gate test"): "A template change cannot reach
 * PRD without an approval record — the test attempts it and fails."
 *
 * Proven THROUGH THE PORT, not against the pure evaluator:
 *  - `published` IS PRD (one environment, ADR-009; transport collapsed).
 *  - "reach PRD" means "become a live candidate through `emit`" — the
 *    real determination runs over `lifecycle.liveState(...)`, so the
 *    assertion is on the real determination outcome/trace, never a mock.
 *  - The approval record is the standing review → approved row in the
 *    append-only `template_lifecycle_log` (migration 0012). A template
 *    seeded straight to `approved` by `registerDocumentType` (S1 seeding)
 *    has the STATE but no RECORD, and the publish attempt fails.
 *
 * The lifecycle service shares the port's registry store (the same wiring
 * `createOutput` uses internally), exactly as task 1's published-only-live
 * test in embed/create-output.test.ts does.
 *
 * No payloads are printed: the memo payload is a one-word title, and the
 * assertions print only statuses, refusal codes, and trace reasons.
 */
import { describe, expect, it } from 'vitest';
import { createOutput } from '../embed/create-output.js';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import type { TemplateLifecycleEvent } from '../registry/registry-store.js';
import { createTemplateLifecycle, type TemplateLifecycleService } from './template-lifecycle.js';

const NOT_LIVE = 'lifecycle: approved — only published templates are live candidates';

const memoContract = { type: 'object', properties: { header: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }, required: ['header'] };
const memoContent = {
  kind: 'document' as const,
  page: { size: 'A4' as const, margin: [40, 40, 40, 40] as [number, number, number, number] },
  children: [{ kind: 'text' as const, value: 'header.title', style: 'title' }],
};

/** One document template declared `approved` — the S1 seed lands it in
 * `approved` with NO approve row. The message template is `published` so
 * the only thing between the event and a live document is the gate. */
const memoDefinition = {
  documentType: 'memo',
  contract: memoContract,
  templates: [{ meta: { id: 'memo-global', variant: { documentType: 'memo' }, version: '1.0.0', lifecycle: 'approved' as const, renderer: 'typst' }, content: memoContent }],
  rules: [{ id: 'memo-email', conditions: { documentType: 'memo' }, resolution: { channel: 'email', recipients: ['x@example.com'] } }],
  messageTemplates: [
    { meta: { id: 'memo-email-v1', variant: { documentType: 'memo' }, version: '1.0.0', lifecycle: 'published' as const }, channel: 'email' as const, subject: ['Memo'], body: ['Attached.'] },
  ],
};
const KEY = { templateId: 'memo-global', version: '1.0.0' };

const alice = { role: 'author', subjectId: 'alice' };
const bob = { role: 'reviewer', subjectId: 'bob' };
const carol = { role: 'approver', subjectId: 'carol' };

let eventSeq = 0;
function memoEvent() {
  eventSeq += 1;
  return { businessObject: 'MEMO', businessObjectId: `M-${eventSeq}`, event: 'memo.issued', templateVersion: '1.0.0' };
}

/** Append-only witness: the log may only grow, and every earlier row must
 * be byte-identical to what it was. */
function appendOnlyWitness(lifecycle: TemplateLifecycleService) {
  let snapshot: string[] = [];
  return {
    check(expectedLength: number): TemplateLifecycleEvent[] {
      const history = lifecycle.history(KEY);
      const rows = history.map((e) => JSON.stringify(e));
      expect(rows.length).toBe(expectedLength);
      expect(rows.length).toBeGreaterThanOrEqual(snapshot.length);
      expect(rows.slice(0, snapshot.length)).toEqual(snapshot);
      snapshot = rows;
      return history;
    },
  };
}

describe('STAGE 5 EXIT GATE — a template change cannot reach PRD without an approval record', () => {
  it('attempting to publish a seeded-approved template fails, and emit never sees it; the proper path passes; a reopen revokes it', async () => {
    const store = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore: store }); // determination-only port
    const lifecycle = createTemplateLifecycle(store);
    const log = appendOnlyWitness(lifecycle);

    // --- S1 seeding: state `approved`, history = one seed row, no approve row.
    expect(port.registerDocumentType(memoDefinition).status).toBe('registered');
    expect(lifecycle.current(KEY)).toBe('approved');
    const [seed] = log.check(1);
    expect(seed).toMatchObject({ fromState: null, toState: 'approved', actorRole: 'registration' });

    // --- THE GATE: the attempt to reach PRD fails.
    expect(lifecycle.transition(KEY, 'published', carol, 'ship it')).toEqual({ status: 'refused', refused: 'approval-record-required', current: 'approved' });
    log.check(1); // a refusal appends nothing

    // ... and the template is NOT live through the real port: determination refuses it with the trace reason.
    const blocked = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent() });
    expect(blocked.status).toBe('no-template-match');
    if (blocked.status !== 'no-template-match') throw new Error('unreachable');
    expect(blocked.trace.resolutions[0].templates).toEqual([expect.objectContaining({ templateId: 'memo-global', matched: false, reasons: expect.arrayContaining([NOT_LIVE]) })]);
    expect(store.listDocuments()).toEqual([]); // nothing minted

    // --- The proper path. `approved` has no edge to `review`; the record
    // is obtained by reopen → submit → approve. Separation of duties:
    // approver ≠ most recent submitter (bob ≠ alice), publisher ≠ standing
    // approver (carol ≠ bob). The submitter publishing (alice) would also
    // be allowed — only the two pairings above are checked.
    expect(lifecycle.transition(KEY, 'draft', alice, 'needs a real review')).toMatchObject({ status: 'transitioned', verb: 'reopen' });
    expect(lifecycle.transition(KEY, 'review', alice, 'ready')).toMatchObject({ status: 'transitioned', verb: 'submit' });
    expect(lifecycle.transition(KEY, 'approved', alice, 'self-approve')).toEqual({ status: 'refused', refused: 'separation-of-duties', current: 'review' });
    expect(lifecycle.transition(KEY, 'approved', bob, 'reviewed')).toMatchObject({ status: 'transitioned', verb: 'approve' });
    expect(lifecycle.transition(KEY, 'published', bob, 'publishing my own approval')).toEqual({ status: 'refused', refused: 'separation-of-duties', current: 'approved' });
    expect(lifecycle.transition(KEY, 'published', carol, 'go live')).toMatchObject({ status: 'transitioned', verb: 'publish' });
    const afterPublish = log.check(5);
    expect(afterPublish.map((e) => `${e.fromState ?? 'seed'}→${e.toState}`)).toEqual(['seed→approved', 'approved→draft', 'draft→review', 'review→approved', 'approved→published']);

    // ... now emit picks the template through the real port.
    const live = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent() });
    expect(live.status).toBe('accepted');
    if (live.status !== 'accepted') throw new Error('unreachable');
    expect(live.resolutions[0].templateId).toBe('memo-global');
    expect(live.trace.resolutions[0].templates).toEqual([expect.objectContaining({ templateId: 'memo-global', matched: true })]);

    store.close();
  });

  it('approve → reopen → publish is refused (the reopen revokes the record), and emit still does not see it', async () => {
    const store = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore: store });
    const lifecycle = createTemplateLifecycle(store);
    const log = appendOnlyWitness(lifecycle);

    expect(port.registerDocumentType(memoDefinition).status).toBe('registered');
    log.check(1);
    expect(lifecycle.transition(KEY, 'draft', alice, 'start over')).toMatchObject({ status: 'transitioned', verb: 'reopen' });
    expect(lifecycle.transition(KEY, 'review', alice, 'ready')).toMatchObject({ status: 'transitioned', verb: 'submit' });
    expect(lifecycle.transition(KEY, 'approved', bob, 'reviewed')).toMatchObject({ status: 'transitioned', verb: 'approve' });
    // A record now stands — then it is revoked by a reopen.
    expect(lifecycle.transition(KEY, 'draft', alice, 'found a typo')).toMatchObject({ status: 'transitioned', verb: 'reopen' });
    log.check(5);

    // From `draft` the edge itself does not exist ...
    expect(lifecycle.transition(KEY, 'published', carol, 'go')).toEqual({ status: 'refused', refused: 'illegal-transition', current: 'draft' });
    // ... and re-reaching `approved` by seed-like means is impossible: the
    // only route is submit → approve again. Submit alone is not enough.
    expect(lifecycle.transition(KEY, 'review', alice, 'fixed')).toMatchObject({ status: 'transitioned', verb: 'submit' });
    expect(lifecycle.transition(KEY, 'published', carol, 'go')).toEqual({ status: 'refused', refused: 'illegal-transition', current: 'review' });
    log.check(6);

    const stillBlocked = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent() });
    expect(stillBlocked.status).toBe('no-template-match');
    if (stillBlocked.status !== 'no-template-match') throw new Error('unreachable');
    expect(stillBlocked.trace.resolutions[0].templates[0].reasons).toContain('lifecycle: review — only published templates are live candidates');
    expect(store.listDocuments()).toEqual([]);

    // Second approval → publish succeeds (the second approve row stands).
    expect(lifecycle.transition(KEY, 'approved', bob, 'reviewed again')).toMatchObject({ status: 'transitioned', verb: 'approve' });
    expect(lifecycle.transition(KEY, 'published', carol, 'go')).toMatchObject({ status: 'transitioned', verb: 'publish' });
    log.check(8);
    expect((await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent() })).status).toBe('accepted');

    store.close();
  });

  it('the S1 seed is the only way into `approved` without a record, and re-registration never re-seeds or launders one', () => {
    const store = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore: store });
    const lifecycle = createTemplateLifecycle(store);
    const log = appendOnlyWitness(lifecycle);

    port.registerDocumentType(memoDefinition);
    log.check(1);
    // Re-registering with a `published` declaration does not touch the log: the store wins.
    const laundered = { ...memoDefinition, templates: [{ ...memoDefinition.templates[0], meta: { ...memoDefinition.templates[0].meta, lifecycle: 'published' as const } }] };
    port.registerDocumentType(laundered);
    log.check(1);
    expect(lifecycle.current(KEY)).toBe('approved');
    expect(lifecycle.transition(KEY, 'published', carol, 'go')).toEqual({ status: 'refused', refused: 'approval-record-required', current: 'approved' });
    log.check(1);

    store.close();
  });
});
