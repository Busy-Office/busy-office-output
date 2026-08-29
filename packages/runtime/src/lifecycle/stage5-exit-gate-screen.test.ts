/**
 * STAGE 5 EXIT GATE, DRIVEN THROUGH THE SCREEN (ROADMAP Stage 5 task 4
 * "Review-and-approve screen ... DoD: the gate test runs through this
 * screen"). The SAME three scenarios as stage5-exit-gate.test.ts, but
 * every transition an operator would make is a real HTTP POST to
 * `/output/templates/:id/:ver/review` on a raw `createIngressServer`
 * (port 0), sharing one `:memory:` store with the port that `emit`s. The
 * lifecycle service is the ORACLE (`lifecycle.history`), with an
 * append-only witness after every step; refusal codes are read off the
 * screen's `data-refusal` attribute — they originate in transitions.ts,
 * the screen only reports them.
 *
 * No payloads are printed: the memo payload's title is a marker string
 * this file asserts NEVER appears in any response body it collected.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOutput } from '../embed/create-output.js';
import { createDocumentTypeRegistry } from '../registration/document-type-registry.js';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import type { RegistryStore, TemplateLifecycleEvent } from '../registry/registry-store.js';
import { createIngressServer } from '../server.js';
import { createTemplateLifecycle, type TemplateLifecycleKey, type TemplateLifecycleService } from './template-lifecycle.js';

const NOT_LIVE = 'lifecycle: approved — only published templates are live candidates';
const MARKER = 'PAYLOAD-MARKER-7f3e9c';

const memoContract = { type: 'object', properties: { header: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }, required: ['header'] };
const memoContent = {
  kind: 'document' as const,
  page: { size: 'A4' as const, margin: [40, 40, 40, 40] as [number, number, number, number] },
  children: [{ kind: 'text' as const, value: 'header.title', style: 'title' }],
};

const memoDefinition = {
  documentType: 'memo',
  contract: memoContract,
  templates: [{ meta: { id: 'memo-global', variant: { documentType: 'memo' }, version: '1.0.0', lifecycle: 'approved' as const, renderer: 'typst' }, content: memoContent }],
  rules: [{ id: 'memo-email', conditions: { documentType: 'memo' }, resolution: { channel: 'email', recipients: ['x@example.com'] } }],
  messageTemplates: [
    { meta: { id: 'memo-email-v1', variant: { documentType: 'memo' }, version: '1.0.0', lifecycle: 'published' as const }, channel: 'email' as const, subject: ['Memo'], body: ['Attached.'] },
  ],
};

/** A second type for the compare/list assertions: v1 live, v2 a changed
 * leaf, v3 identical content, v2/v3 declared draft (no seed-to-approved). */
const noteDefinition = {
  documentType: 'note',
  contract: memoContract,
  templates: [
    { meta: { id: 'note-v1', variant: { documentType: 'note' }, version: '1.0.0', lifecycle: 'published' as const, renderer: 'typst' }, content: memoContent },
    { meta: { id: 'note-v2', variant: { documentType: 'note' }, version: '2.0.0', lifecycle: 'draft' as const, renderer: 'typst', parentId: 'note-v1' }, content: { ...memoContent, children: [{ kind: 'text' as const, value: 'header.subtitle', style: 'title' }] } },
    { meta: { id: 'note-v3', variant: { documentType: 'note' }, version: '3.0.0', lifecycle: 'draft' as const, renderer: 'typst' }, content: memoContent },
  ],
  rules: [],
};

const KEY = { templateId: 'memo-global', version: '1.0.0' };
const REVIEW = '/output/templates/memo-global/1.0.0/review';

const alice = { subject: 'alice', role: 'author' };
const bob = { subject: 'bob', role: 'reviewer' };
const carol = { subject: 'carol', role: 'approver' };

let eventSeq = 0;
function memoEvent() {
  eventSeq += 1;
  return { businessObject: 'MEMO', businessObjectId: `M-${eventSeq}`, event: 'memo.issued', templateVersion: '1.0.0' };
}

function appendOnlyWitness(lifecycle: TemplateLifecycleService, key: TemplateLifecycleKey) {
  let snapshot: string[] = [];
  return {
    check(expectedLength: number): TemplateLifecycleEvent[] {
      const history = lifecycle.history(key);
      const rows = history.map((e) => JSON.stringify(e));
      expect(rows.length).toBe(expectedLength);
      expect(rows.length).toBeGreaterThanOrEqual(snapshot.length);
      expect(rows.slice(0, snapshot.length)).toEqual(snapshot);
      snapshot = rows;
      return history;
    },
  };
}

describe('STAGE 5 EXIT GATE through the review screen', () => {
  let baseUrl: string;
  let store: RegistryStore;
  let server: ReturnType<typeof createIngressServer>;
  let port: ReturnType<typeof createOutput>;
  let lifecycle: TemplateLifecycleService;
  /** Every response body this file received — the marker must be in none. */
  const bodies: string[] = [];

  beforeAll(async () => {
    store = createSqliteRegistryStore(':memory:');
    const documentTypes = createDocumentTypeRegistry();
    port = createOutput({ registryStore: store, documentTypes });
    expect(port.registerDocumentType(memoDefinition).status).toBe('registered');
    expect(port.registerDocumentType(noteDefinition).status).toBe('registered');
    lifecycle = createTemplateLifecycle(store);
    server = createIngressServer({ registryStore: store, documentTypes, output: port });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  async function request(path: string, init: RequestInit = {}) {
    const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init });
    const body = await res.text();
    bodies.push(body);
    return { status: res.status, location: res.headers.get('location'), contentType: res.headers.get('content-type') ?? '', body };
  }

  function postReview(actor: { subject: string; role: string } | undefined, fields: Record<string, string>, extraHeaders: Record<string, string> = {}, path = REVIEW) {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders };
    if (actor !== undefined) {
      headers['X-Actor-Subject'] = actor.subject;
      headers['X-Actor-Role'] = actor.role;
    }
    return request(path, { method: 'POST', headers, body: new URLSearchParams(fields).toString() });
  }

  function refusalOf(body: string): string | undefined {
    return /data-refusal="([^"]+)"/.exec(body)?.[1];
  }

  function primaryCount(body: string): number {
    return (body.match(/<button type="submit" class="primary"/g) ?? []).length;
  }

  async function emitMemo() {
    return port.emit({ documentType: 'memo', payload: { header: { title: MARKER } }, businessEvent: memoEvent() });
  }

  it('seeded-approved: Publish is refused on the screen (approval-record-required), the log does not grow, emit still does not see it', async () => {
    const log = appendOnlyWitness(lifecycle, KEY);
    log.check(1);

    const screen = await request(REVIEW);
    expect(screen.status).toBe(200);
    expect(screen.body).toContain('approved · approval record: none (seeded by definition:memo)');
    expect(primaryCount(screen.body)).toBe(1);
    expect(screen.body).toContain('value="publish">Publish</button>');
    expect(screen.body).toContain('no actor identity on this request');

    const refused = await postReview(carol, { action: 'publish', reason: 'ship it' });
    expect(refused.status).toBe(422);
    expect(refusalOf(refused.body)).toBe('approval-record-required');
    expect(refused.body).toContain('acting as carol (approver)');
    expect(refused.body).toContain('>ship it</textarea>'); // typed reason preserved
    log.check(1);

    const blocked = await emitMemo();
    expect(blocked.status).toBe('no-template-match');
    if (blocked.status !== 'no-template-match') throw new Error('unreachable');
    // The trace lists every candidate (the note templates too — same registry); memo-global is the one refused for lifecycle.
    expect(blocked.trace.resolutions[0].templates).toContainEqual(expect.objectContaining({ templateId: 'memo-global', matched: false, reasons: expect.arrayContaining([NOT_LIVE]) }));
    expect(blocked.trace.resolutions[0].templates.some((t) => t.matched)).toBe(false);
    expect(store.listDocuments()).toEqual([]);
  });

  it('the proper path through the screen: send back → submit (service) → approve (SoD) → publish (SoD) → 303 → emit accepted', async () => {
    const log = appendOnlyWitness(lifecycle, KEY);
    log.check(1);

    const sentBack = await postReview(alice, { action: 'reopen', reason: 'needs a real review' });
    expect(sentBack.status).toBe(303);
    expect(sentBack.location).toBe('/output/templates');
    expect(log.check(2)[1]).toMatchObject({ fromState: 'approved', toState: 'draft', actorSubjectId: 'alice', actorRole: 'author', reason: 'needs a real review' });

    // Draft phase: no primary, no submit control — submit happens where drafts are made.
    const draftScreen = await request(REVIEW);
    expect(primaryCount(draftScreen.body)).toBe(0);
    expect(draftScreen.body).toContain('draft — submit for review happens where drafts are made');
    expect(lifecycle.transition(KEY, 'review', { role: 'author', subjectId: 'alice' }, 'ready')).toMatchObject({ status: 'transitioned', verb: 'submit' });
    log.check(3);

    const reviewScreen = await request(REVIEW);
    expect(primaryCount(reviewScreen.body)).toBe(1);
    expect(reviewScreen.body).toContain('value="approve">Approve</button>');
    expect(reviewScreen.body).toContain('value="return">Send back to draft</button>');

    const selfApprove = await postReview(alice, { action: 'approve', reason: 'self-approve' });
    expect(selfApprove.status).toBe(422);
    expect(refusalOf(selfApprove.body)).toBe('separation-of-duties');
    log.check(3);

    const approved = await postReview(bob, { action: 'approve', reason: 'reviewed' });
    expect(approved.status).toBe(303);
    log.check(4);

    const approvedScreen = await request(REVIEW);
    expect(approvedScreen.body).toMatch(/approved · approval record: bob \(reviewer\) · reviewed · /);
    expect(primaryCount(approvedScreen.body)).toBe(1);

    const ownApproval = await postReview(bob, { action: 'publish', reason: 'publishing my own approval' });
    expect(ownApproval.status).toBe(422);
    expect(refusalOf(ownApproval.body)).toBe('separation-of-duties');
    log.check(4);

    const published = await postReview(carol, { action: 'publish', reason: 'go live' });
    expect(published.status).toBe(303);
    expect(published.location).toBe('/output/templates');
    const afterPublish = log.check(5);
    expect(afterPublish.map((e) => `${e.fromState ?? 'seed'}→${e.toState}`)).toEqual(['seed→approved', 'approved→draft', 'draft→review', 'review→approved', 'approved→published']);

    const live = await emitMemo();
    expect(live.status).toBe('accepted');
    if (live.status !== 'accepted') throw new Error('unreachable');
    expect(live.resolutions[0].templateId).toBe('memo-global');

    // Published / retired phases: no primary.
    const publishedScreen = await request(REVIEW);
    expect(primaryCount(publishedScreen.body)).toBe(0);
    expect(publishedScreen.body).toContain('published — live');
    // History for THIS key only, oldest first, every row present.
    const historyIndex = publishedScreen.body.indexOf('Lifecycle history');
    const tail = publishedScreen.body.slice(historyIndex);
    expect(tail.indexOf('seed → approved')).toBeLessThan(tail.indexOf('approved → draft'));
    expect(tail.indexOf('review → approved')).toBeLessThan(tail.indexOf('approved → published'));
    expect(tail).not.toContain('note-v1');
  });

  it('transport refusals append nothing: missing actor 400, blank reason 422, unknown action 400, cross-site 403, PUT 405, POST elsewhere 405', async () => {
    // Drive a fresh key into `review` so a well-formed approve would be legal.
    const noteKey = { templateId: 'note-v3', version: '3.0.0' };
    const notePath = '/output/templates/note-v3/3.0.0/review';
    expect(lifecycle.transition(noteKey, 'review', { role: 'author', subjectId: 'alice' }, 'ready')).toMatchObject({ status: 'transitioned' });
    const log = appendOnlyWitness(lifecycle, noteKey);
    log.check(2);

    const noActor = await postReview(undefined, { action: 'approve', reason: 'x' }, {}, notePath);
    expect(noActor.status).toBe(400);
    expect(noActor.body).toContain('actor-required');
    log.check(2);

    const blank = await postReview(bob, { action: 'approve', reason: '   ' }, {}, notePath);
    expect(blank.status).toBe(422);
    expect(refusalOf(blank.body)).toBe('reason-required');
    // Under the textarea, before the primary.
    expect(blank.body.indexOf('data-refusal="reason-required"')).toBeGreaterThan(blank.body.indexOf('</textarea>'));
    expect(blank.body.indexOf('data-refusal="reason-required"')).toBeLessThan(blank.body.indexOf('class="primary"'));
    log.check(2);

    const unknown = await postReview(bob, { action: 'retire', reason: 'x' }, {}, notePath);
    expect(unknown.status).toBe(400);
    expect(unknown.body).toContain('unknown-review-action');
    log.check(2);

    const crossSite = await postReview(bob, { action: 'approve', reason: 'x' }, { 'Sec-Fetch-Site': 'cross-site' }, notePath);
    expect(crossSite.status).toBe(403);
    log.check(2);

    const put = await request(notePath, { method: 'PUT', headers: { 'X-Actor-Subject': 'bob' }, body: 'action=approve&reason=x' });
    expect(put.status).toBe(405);
    const del = await request(notePath, { method: 'DELETE', headers: { 'X-Actor-Subject': 'bob' } });
    expect(del.status).toBe(405);
    const elsewhere = await postReview(bob, { action: 'approve', reason: 'x' }, {}, '/output/documents');
    expect(elsewhere.status).toBe(405);
    const listPost = await postReview(bob, { action: 'approve', reason: 'x' }, {}, '/output/templates');
    expect(listPost.status).toBe(405);
    const unknownKey = await postReview(bob, { action: 'approve', reason: 'x' }, {}, '/output/templates/nope/9.9.9/review');
    expect(unknownKey.status).toBe(404);
    log.check(2);

    // Same-origin / absent Sec-Fetch-Site are accepted — the legal approve lands.
    const ok = await postReview(bob, { action: 'approve', reason: 'fine' }, { 'Sec-Fetch-Site': 'same-origin' }, notePath);
    expect(ok.status).toBe(303);
    log.check(3);
  });

  it('no control in any phase is a submit or retire verb; the only writable control is the reason textarea', async () => {
    const screens = await Promise.all([REVIEW, '/output/templates/note-v2/2.0.0/review', '/output/templates/note-v3/3.0.0/review'].map((p) => request(p)));
    for (const { body } of screens) {
      const controls = body.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
      for (const control of controls) {
        expect(control).not.toMatch(/value="(submit|retire)"/);
        expect(control).not.toMatch(/>\s*(Submit|Retire)/);
      }
      expect(body.match(/<textarea name="reason" required/g)).toHaveLength(1);
      expect(body).not.toContain('<script');
      expect(body).not.toContain('<input');
    }
  });

  it('compare: a changed leaf gives the expected pointer row; identical content says so; the live baseline is named', async () => {
    const changed = await request('/output/templates/note-v2/2.0.0/review');
    expect(changed.status).toBe(200);
    expect(changed.body).toContain('live now: note-v1@1.0.0 — stays live after publish until retired');
    expect(changed.body).toContain('~ /children/0/value &quot;header.title&quot; → &quot;header.subtitle&quot;');
    expect(changed.body).toContain('+ /meta/parentId = &quot;note-v1&quot;'); // absent on the baseline → a `+` row
    expect(changed.body).not.toContain('no structural change');

    const identical = await request('/output/templates/note-v3/3.0.0/review');
    expect(identical.body).toContain('no structural change');
    expect(identical.body).toContain('no meta change');

    // memo-global is the only memo document template: first publication.
    const first = await request(REVIEW);
    expect(first.body).toContain('no published version of this variant — first publication');
    expect(first.body).toContain('1 registered rule(s) can resolve onto this variant');

    // Message templates diff over { subject, body } and are listed too.
    const message = await request('/output/templates/memo-email-v1/1.0.0/review');
    expect(message.status).toBe(200);
    expect(message.body).toContain('memo-email-v1@1.0.0 · memo · (all variants) · message · —');
  });

  it('Templates list: log-truth lifecycle, a superseded version still shows published, indent by parentId, links only to review; review links only to the list', async () => {
    // Publish note-v2 through the service: note-v1 stays published (GAP-20).
    const v2 = { templateId: 'note-v2', version: '2.0.0' };
    const A = { role: 'author', subjectId: 'alice' };
    expect(lifecycle.transition(v2, 'review', A, 'ready')).toMatchObject({ status: 'transitioned' });
    expect(lifecycle.transition(v2, 'approved', { role: 'reviewer', subjectId: 'bob' }, 'ok')).toMatchObject({ status: 'transitioned' });
    expect(lifecycle.transition(v2, 'published', { role: 'approver', subjectId: 'carol' }, 'go')).toMatchObject({ status: 'transitioned' });

    const list = await request('/output/templates');
    expect(list.status).toBe(200);
    const rows = list.body.match(/<li class="row"[\s\S]*?<\/li>/g) ?? [];
    const rowFor = (id: string) => rows.find((r) => r.includes(`>${id}@`)) ?? '';
    expect(rowFor('note-v1')).toContain('<div>published</div>');
    expect(rowFor('note-v2')).toContain('<div>published</div>');
    expect(rowFor('note-v2')).toContain('margin-left: 1.5rem'); // inherits from note-v1
    expect(rowFor('memo-global')).toContain('<div>published</div>'); // log truth, declared was `approved`
    expect(rowFor('memo-email-v1')).toContain('· message');
    expect(rowFor('note-v3')).toContain('<div>approved</div>');

    // Stage 5 task 5 added the one nav line to every page; these two
    // assertions are about the SCREEN's own links, so they read the body
    // below `</nav>` (the nav itself is asserted byte-exact in console.test.ts).
    const belowNav = (body: string) => body.slice(body.indexOf('</nav>') + '</nav>'.length);
    const hrefs = [...belowNav(list.body).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^\/output\/templates\/[^/]+\/[^/]+\/review$/);

    const review = await request(REVIEW);
    const reviewHrefs = [...belowNav(review.body).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(reviewHrefs).toEqual(['/output/templates']);
    // The list is 404 on a server with no template source; the review path is exact.
    expect((await request('/output/templates/memo-global/1.0.0/other')).status).toBe(404);
  });

  it('the payload marker never appears in any response body', () => {
    expect(bodies.length).toBeGreaterThan(10);
    expect(bodies.some((b) => b.includes(MARKER))).toBe(false);
  });
});
