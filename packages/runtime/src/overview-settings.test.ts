/**
 * Overview (failures-first home) + Settings (Stage 5 task 5): real HTTP
 * requests against `createIngressServer` (server.ts), same pattern as
 * console.test.ts. Nothing below prints a payload, recipient, message, or
 * credential — the PLANTED-* strings exist only to be asserted ABSENT.
 */
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Renderer } from '@busy-office/output-schema';
import { createIngressServer } from './server.js';
import { buildConsoleFacts, registerBuiltinDocumentTypes } from './index.js';
import { CONSOLE_SECTION_PATHS, STRANDED_AFTER_MS, renderOverviewPage, type ConsoleFacts } from './console.js';
import { createOutput } from './embed/create-output.js';
import { createDocumentTypeRegistry } from './registration/document-type-registry.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import { FsArchiveStore } from './archive/fs-archive-store.js';
import { archiveArtifact } from './archive/index.js';
import { SqliteDeliveryQueue } from './delivery/index.js';
import type { ChannelSender } from './delivery/channel-sender.js';
import { createTemplateLifecycle } from './lifecycle/template-lifecycle.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

const ALL_GREEN_BODY = '<h1>Overview</h1><p>Nothing needs attention.</p>';
const NAV =
  '<nav class="console"><a href="/output">Overview</a> · <a href="/output/documents">Documents</a> · <a href="/output/templates">Templates</a> · <a href="/output/operations">Operations</a> · <a href="/output/settings">Settings</a></nav>';

/** What sits between the nav and `</body>`. */
function belowNav(html: string): string {
  const start = html.indexOf('</nav>\n') + '</nav>\n'.length;
  const end = html.lastIndexOf('\n</body>');
  return html.slice(start, end);
}
function navOf(html: string): string {
  return html.slice(html.indexOf('<nav'), html.indexOf('</nav>') + '</nav>'.length);
}
function h2s(html: string): string[] {
  return [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
}
function sectionFor(html: string, heading: string): string {
  const start = html.indexOf(`<section><h2>${heading}</h2>`);
  expect(start, `section "${heading}" present`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf('</section>', start));
}
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('#'));
}

// Type-level closedness (also enforced in console.ts under `tsc`): no key
// at any depth of ConsoleFacts matches /pass|secret|token|key/i.
type CredentialShaped<K extends string> = Lowercase<K> extends `${string}${'pass' | 'secret' | 'token' | 'key'}${string}` ? K : never;
type CredentialShapedKeys<T> = T extends readonly (infer U)[]
  ? CredentialShapedKeys<U>
  : T extends object
    ? { [K in keyof T & string]: CredentialShaped<K> | CredentialShapedKeys<T[K]> }[keyof T & string]
    : never;
const consoleFactsIsClosed: [CredentialShapedKeys<ConsoleFacts>] extends [never] ? true : never = true;

const memoContract = { type: 'object', properties: { header: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }, required: ['header'] };
const memoContent = { kind: 'document' as const, page: { size: 'A4' as const, margin: [40, 40, 40, 40] as [number, number, number, number] }, children: [{ kind: 'text' as const, value: 'header.title', style: 'title' }] };
/** Test-local type: no `retentionYears` (→ default row), one draft template we push into review. */
const memoDefinition = {
  documentType: 'memo',
  contract: memoContract,
  templates: [{ meta: { id: 'memo-draft', variant: { documentType: 'memo' }, version: '2.0.0', lifecycle: 'draft' as const, renderer: 'typst' }, content: memoContent }],
  rules: [],
};

function fakeRenderer(id: string, version: string): Renderer {
  return { id, version, accepts: ['document'], render: async () => { throw new Error('never rendered in this test'); } } as unknown as Renderer;
}
const RENDERERS = { typst: fakeRenderer('typst', '0.15.1'), 'pdf-direct': fakeRenderer('pdf-direct', '1.17.1') };

class AlwaysFailingSender implements ChannelSender {
  async send(): Promise<void> { throw new Error('channel is dead (simulated)'); }
}
/** An attempt that never returns — leaves the job `in_progress`. */
class HangingSender implements ChannelSender {
  send(): Promise<void> { return new Promise<void>(() => {}); }
}

const BACKOFF = { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 };
const PLANTED = {
  recipient: 'planted-recipient@example.com',
  subject: 'PLANTED-SUBJECT-4d2a',
  body: 'PLANTED-BODY-9e1c',
  ownerId: 'PLANTED-OWNER-EMP-77',
  renderError: 'PLANTED-RENDER-ERROR-3b8f',
  smtpUser: 'PLANTED-USER-7f3a',
  smtpPass: 'PLANTED-PASS-9c1e',
  awsId: 'PLANTED-AKIA-0000',
  awsSecret: 'PLANTED-SECRET-ffff',
};
const SECRET_STRINGS = [PLANTED.smtpUser, PLANTED.smtpPass, PLANTED.awsId, PLANTED.awsSecret];

describe('Overview (GET /output) and Settings (GET /output/settings)', () => {
  const tempDirs: string[] = [];
  const closers: Array<() => Promise<void> | void> = [];
  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }
  afterEach(async () => {
    while (closers.length > 0) await closers.pop()?.();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A full fixture: on-disk registry (so rows can be backdated), queue,
   * built-ins + memo, lifecycle, facts. Every failure group starts EMPTY;
   * each test seeds what it needs. */
  async function buildFixture(facts?: (input: Parameters<typeof buildConsoleFacts>[0]) => ConsoleFacts) {
    const dbPath = join(tempDir('overview-db-'), 'registry.db');
    const archiveDir = tempDir('overview-archive-');
    const outboxDir = tempDir('overview-outbox-');
    const registryStore = createSqliteRegistryStore(dbPath);
    const archiveStore = new FsArchiveStore(archiveDir);
    const deliveryQueue = new SqliteDeliveryQueue(dbPath, { registryStore, archiveStore, backoffPolicy: BACKOFF, onPoisonAlert: () => {} });
    const documentTypes = createDocumentTypeRegistry();
    const output = createOutput({ registryStore, documentTypes });
    registerBuiltinDocumentTypes(output);
    expect(output.registerDocumentType(memoDefinition).status).toBe('registered');
    const lifecycle = createTemplateLifecycle(registryStore);
    const factsInput = {
      sender: { kind: 'filesystem' as const, outboxDir },
      archive: { kind: 'filesystem' as const, archiveDir },
      dbPath,
      backoffPolicy: BACKOFF,
      workerIntervalMs: 1000,
      documentTypes,
      renderers: RENDERERS,
      defaultRendererId: 'typst',
    };
    const consoleFacts = facts === undefined ? buildConsoleFacts(factsInput) : facts(factsInput);
    const server = createIngressServer({ registryStore, documentTypes, output, deliveryQueue, backoffPolicy: BACKOFF, consoleFacts });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const db = new DatabaseSync(dbPath);
    closers.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      deliveryQueue.close();
      registryStore.close();
    });

    async function get(path: string) {
      const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
      return { status: res.status, location: res.headers.get('location'), headers, body: await res.text() };
    }
    async function mintArchived(businessObjectId: string, documentType = 'purchase-order', ownerId?: string): Promise<string> {
      const { row } = registryStore.getOrCreateByResolutionKey(
        { businessObject: 'EKKO', businessObjectId, event: 'po.released', templateVersion: '1.0.0', ruleId: 'r1' },
        documentType,
        ownerId,
      );
      await archiveArtifact({ archiveStore, registryStore, docId: row.docId, bytes: new TextEncoder().encode('%PDF-1.7 fake'), mediaType: 'application/pdf', retentionUntil: '2030-01-01T00:00:00Z', renderer: { id: 'typst', version: '0.15.1' } });
      return row.docId;
    }
    async function poison(businessObjectId: string, channel = 'email', recipients = ['x@example.com'], message?: { subject: string; body: string }, documentType?: string, ownerId?: string): Promise<string> {
      const docId = await mintArchived(businessObjectId, documentType, ownerId);
      const job = deliveryQueue.enqueue({ docId, channel, recipients, ...(message !== undefined ? { message } : {}) });
      await deliveryQueue.attemptDelivery(job.id, new AlwaysFailingSender());
      expect((await deliveryQueue.attemptDelivery(job.id, new AlwaysFailingSender())).outcome).toBe('poisoned');
      return docId;
    }
    /** A `mintWithOutbox` row: `cleared` = render failed (outbox cleared, DRAFT stays). */
    function mintDraft(businessObjectId: string, cleared: boolean): string {
      const { row } = registryStore.mintWithOutbox(
        { businessObject: 'EKKO', businessObjectId, event: 'po.released', templateVersion: '1.0.0', ruleId: 'r1' },
        { ruleId: 'r1' },
        { header: { note: 'never printed' } },
        'purchase-order',
      );
      if (cleared) registryStore.clearOutboxEntry(row.docId);
      return row.docId;
    }
    async function stuck(businessObjectId: string): Promise<{ docId: string; jobId: number }> {
      const docId = await mintArchived(businessObjectId);
      const job = deliveryQueue.enqueue({ docId, channel: 'email', recipients: ['y@example.com'] });
      void deliveryQueue.attemptDelivery(job.id, new HangingSender());
      await new Promise((r) => setTimeout(r, 2));
      expect(deliveryQueue.getJob(job.id)?.status).toBe('in_progress');
      return { docId, jobId: job.id };
    }
    const past = new Date(Date.now() - STRANDED_AFTER_MS - 1000).toISOString();
    function backdateOutbox(docId: string): void {
      db.prepare('UPDATE composition_outbox SET created_at = ? WHERE doc_id = ?').run(past, docId);
    }
    function backdateJob(jobId: number): void {
      db.prepare('UPDATE delivery_queue SET updated_at = ? WHERE id = ?').run(past, jobId);
    }
    /** Rows minted directly have no persisted trace; the crawl and the
     * no-secret sweep want the Rule trace screen reachable, so seed one. */
    function seedTrace(docId: string): void {
      registryStore.appendTraceLog(docId, { documentType: 'purchase-order', businessObject: 'EKKO', event: 'po.released', outcome: 'matched', rules: [], resolutions: [] });
    }
    function submitForReview(): string {
      const key = { templateId: 'memo-draft', version: '2.0.0' };
      expect(lifecycle.transition(key, 'review', { subjectId: 'alice', role: 'author' }, 'ready').status).toBe('transitioned');
      return '/output/templates/memo-draft/2.0.0/review';
    }

    return { registryStore, deliveryQueue, lifecycle, documentTypes, get, mintArchived, poison, mintDraft, stuck, backdateOutbox, backdateJob, seedTrace, submitForReview };
  }

  it('all green: the body after the nav is byte-exact, no zeros, no list, no timestamp; `/output/` 301s to `/output`', async () => {
    const f = await buildFixture();
    const page = await f.get('/output');
    expect(page.status).toBe(200);
    expect(belowNav(page.body)).toBe(ALL_GREEN_BODY);
    expect(navOf(page.body)).toBe(NAV);
    const slash = await f.get('/output/');
    expect(slash.status).toBe(301);
    expect(slash.location).toBe('/output');
  });

  it('bare server (no queue, no registry, no facts): overview is the same all-green body; settings 404s', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const server = createIngressServer({ registryStore });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    closers.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); registryStore.close(); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const body = await (await fetch(`${base}/output`)).text();
    expect(belowNav(body)).toBe(ALL_GREEN_BODY);
    expect((await fetch(`${base}/output/settings`)).status).toBe(404);
  });

  it('Poison deliveries: exactly one row, docId · channel · attempt n/max — lastError, linked to Operations?q=docId', async () => {
    const f = await buildFixture();
    const docId = await f.poison('ov-poison-1', 'email', ['a@example.com']);
    const page = belowNav((await f.get('/output')).body);
    expect(h2s(page)).toEqual(['Poison deliveries']);
    const section = sectionFor(page, 'Poison deliveries');
    expect(section.match(/<li class="row">/g)).toHaveLength(1);
    expect(section).toContain(`<a href="/output/operations?q=${docId}">${docId}</a> · email · attempt 2/2 — channel is dead (simulated)`);
    expect(section).not.toContain('a@example.com');
  });

  it('Not archived: a render-failed DRAFT (outbox cleared) appears with no threshold, says only `not archived`, never the renderer error', async () => {
    const f = await buildFixture();
    const docId = f.mintDraft('ov-render-failed', true);
    const page = belowNav((await f.get('/output')).body);
    expect(h2s(page)).toEqual(['Not archived']);
    const section = sectionFor(page, 'Not archived');
    expect(section.match(/<li class="row">/g)).toHaveLength(1);
    expect(section).toContain(`<a href="/output/documents/${docId}">${docId}</a> · purchase-order · 1.0.0 · created `);
    expect(section).toContain('· not archived</li>');
    expect(section).not.toContain(PLANTED.renderError);
    expect(section).not.toContain('never printed');
  });

  it('Not archived: a pending outbox row younger than STRANDED_AFTER_MS is absent; older is present; a docId never appears twice', async () => {
    const f = await buildFixture();
    const young = f.mintDraft('ov-outbox-young', false);
    const old = f.mintDraft('ov-outbox-old', false);
    f.backdateOutbox(old);
    const page = belowNav((await f.get('/output')).body);
    expect(page).not.toContain(young);
    const section = sectionFor(page, 'Not archived');
    expect(section.match(/<li class="row">/g)).toHaveLength(1);
    expect(section.split(old).length - 1).toBe(2); // once in href, once as link text — one row
    expect(page.match(new RegExp(`<a href="/output/documents/${old}"`, 'g'))).toHaveLength(1);
  });

  it('Stuck deliveries: setStatus(in_progress) advances updatedAt; younger than threshold absent, older present', async () => {
    const f = await buildFixture();
    const docId = await f.mintArchived('ov-stuck-updated');
    const enqueued = f.deliveryQueue.enqueue({ docId, channel: 'email', recipients: ['z@example.com'] });
    await new Promise((r) => setTimeout(r, 5));
    void f.deliveryQueue.attemptDelivery(enqueued.id, new HangingSender());
    await new Promise((r) => setTimeout(r, 2));
    const inProgress = f.deliveryQueue.getJob(enqueued.id);
    expect(inProgress?.status).toBe('in_progress');
    expect(Date.parse(inProgress!.updatedAt)).toBeGreaterThan(Date.parse(enqueued.updatedAt));

    const { docId: stuckDocId, jobId } = await f.stuck('ov-stuck-old');
    let page = belowNav((await f.get('/output')).body);
    expect(page).toBe(ALL_GREEN_BODY); // both in_progress rows are young
    f.backdateJob(jobId);
    page = belowNav((await f.get('/output')).body);
    expect(h2s(page)).toEqual(['Stuck deliveries']);
    const section = sectionFor(page, 'Stuck deliveries');
    expect(section.match(/<li class="row">/g)).toHaveLength(1);
    expect(section).toContain(`<a href="/output/operations?q=${stuckDocId}">${stuckDocId}</a> · email · attempt 0/2 · in progress since `);
    expect(page).not.toContain(docId);
  });

  it('Awaiting approval: exactly one row, templateId@version · documentType · in review since <last log row>, linked to the review route; alone it is the only section', async () => {
    const f = await buildFixture();
    const reviewPath = f.submitForReview();
    const since = f.lifecycle.history({ templateId: 'memo-draft', version: '2.0.0' }).at(-1)!.occurredAt;
    const page = belowNav((await f.get('/output')).body);
    expect(page.match(/<section>/g)).toHaveLength(1);
    expect(h2s(page)).toEqual(['Awaiting approval']);
    const section = sectionFor(page, 'Awaiting approval');
    expect(section.match(/<li class="row">/g)).toHaveLength(1);
    expect(section).toContain(`<a href="${reviewPath}">memo-draft@2.0.0</a> · memo · in review since ${since}`);
    expect((await f.get(reviewPath)).status).toBe(200);
  });

  it('ordering with all four groups: poison, not archived, stuck, awaiting approval (worst-first, approval last); no empty group renders', async () => {
    const f = await buildFixture();
    f.submitForReview();
    const { jobId } = await f.stuck('ov-all-stuck');
    f.backdateJob(jobId);
    f.mintDraft('ov-all-draft', true);
    await f.poison('ov-all-poison');
    const page = belowNav((await f.get('/output')).body);
    expect(h2s(page)).toEqual(['Poison deliveries', 'Not archived', 'Stuck deliveries', 'Awaiting approval']);
    expect(page).not.toContain('<ul class="rows">\n\n</ul>');
    expect(page).not.toContain('Nothing needs attention');
  });

  it('no counters: three poison rows yield no digit-adjacent failure/poison phrase, and the nav is byte-identical to the all-green nav', async () => {
    const f = await buildFixture();
    await f.poison('ov-count-1');
    await f.poison('ov-count-2');
    await f.poison('ov-count-3');
    const html = (await f.get('/output')).body;
    const page = belowNav(html);
    expect(page.match(/<li class="row">/g)).toHaveLength(3);
    expect(page).not.toMatch(/\d\s*(failures?|poison)/i);
    expect(page).not.toMatch(/(failures?|poison)\w*:?\s*\d/i);
    expect(page).not.toMatch(/\b(total|volume|today)\b/i);
    expect(navOf(html)).toBe(NAV);
    expect(html.match(/<nav/g)).toHaveLength(1);
  });

  it('PII scrub: a poisoned payslip email job leaks no recipient, subject, body, or ownerId into /output or /output/settings', async () => {
    const f = await buildFixture();
    const docId = await f.poison('ov-pii-payslip', 'email', [PLANTED.recipient], { subject: PLANTED.subject, body: PLANTED.body }, 'payslip', PLANTED.ownerId);
    for (const path of ['/output', '/output/settings']) {
      const { body, headers } = await f.get(path);
      for (const secret of [PLANTED.recipient, PLANTED.subject, PLANTED.body, PLANTED.ownerId]) {
        expect(body, `${path} body`).not.toContain(secret);
        expect(headers, `${path} headers`).not.toContain(secret);
      }
    }
    expect((await f.get('/output')).body).toContain(docId);
  });

  it('Settings: four sections in order, each a <dl class="facts">, zero form controls, no links but the nav', async () => {
    const f = await buildFixture();
    const res = await f.get('/output/settings');
    expect(res.status).toBe(200);
    const page = belowNav(res.body);
    expect(h2s(page)).toEqual(['Channels', 'Retention', 'Renderers', 'Access']);
    expect(page.match(/<dl class="facts">/g)).toHaveLength(4);
    expect(page).not.toMatch(/<(form|input|button|select|textarea)\b/i);
    expect(hrefs(page)).toEqual([]);
    expect(page).not.toMatch(/\bsave\b/i);

    const channels = sectionFor(page, 'Channels');
    expect(channels).toMatch(/<dt>delivery sender<\/dt><dd>filesystem outbox · .*overview-outbox-/);
    expect(channels).toContain('<dt>retry policy</dt><dd>maxAttempts 2 · baseDelayMs 1 · maxDelayMs 1</dd>');
    expect(channels).toContain('<dt>worker poll</dt><dd>intervalMs 1000</dd>');

    const retention = sectionFor(page, 'Retention');
    expect(retention).toContain('<dt>invoice</dt><dd>10 years</dd>');
    expect(retention).toContain('<dt>payslip</dt><dd>6 years</dd>');
    expect(retention).toContain('<dt>purchase-order</dt><dd>3 years</dd>');
    expect(retention).toContain('<dt>memo</dt><dd>10 years (default)</dd>');
    expect(retention).toContain('<dt>default</dt><dd>10 years</dd>');
    expect(retention).toMatch(/<dt>archive<\/dt><dd>filesystem · .*overview-archive-/);
    expect(retention).toMatch(/<dt>registry<\/dt><dd>sqlite · .*registry\.db<\/dd>/);

    const renderers = sectionFor(page, 'Renderers');
    expect(renderers).toContain('<dt>typst</dt><dd>typst@0.15.1 · default</dd>');
    expect(renderers).toContain('<dt>pdf-direct</dt><dd>pdf-direct@1.17.1</dd>');
    expect(renderers.match(/default/g)).toHaveLength(1);

    const access = sectionFor(page, 'Access');
    expect(access).toContain('X-Actor-Subject');
    expect(access).toContain('not authenticated by this runtime');
    expect(access).toContain('<dt>CSRF guard</dt><dd>Sec-Fetch-Site cross-site → 403</dd>');
    expect(access).toContain('<dt>document authorization</dt><dd>AuthorizationPort (owner-scoped types: payslip)</dd>');
  });

  it('NO-SECRET: email auth and S3 credentials reach the console only as `configured`; the planted strings appear on no route, in no header', async () => {
    const prev = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };
    process.env.AWS_ACCESS_KEY_ID = PLANTED.awsId;
    process.env.AWS_SECRET_ACCESS_KEY = PLANTED.awsSecret;
    try {
      const f = await buildFixture((input) =>
        buildConsoleFacts({
          ...input,
          sender: { kind: 'email', smtp: { host: 'smtp.example.test', port: 587, secure: true, auth: { user: PLANTED.smtpUser, pass: PLANTED.smtpPass } } },
          archive: { kind: 's3', options: { bucket: 'planted-bucket', endpoint: 'https://s3.example.test', keyPrefix: 'artifacts/' } },
        }),
      );
      const docId = await f.poison('ov-secret-1');
      f.seedTrace(docId);
      const draft = f.mintDraft('ov-secret-draft', true);
      const review = f.submitForReview();
      const routes = [...CONSOLE_SECTION_PATHS, `/output/documents/${docId}`, `/output/documents/${draft}`, `/output/trace/${docId}`, `/output/operations?q=${docId}`, review, '/output/documents?q=ov-secret'];
      for (const path of routes) {
        const { status, body, headers } = await f.get(path);
        expect(status, path).toBeLessThan(400);
        for (const secret of SECRET_STRINGS) {
          expect(body, `${path} body`).not.toContain(secret);
          expect(headers, `${path} headers`).not.toContain(secret);
        }
      }
      const settings = belowNav((await f.get('/output/settings')).body);
      expect(settings).toContain('<dt>delivery sender</dt><dd>email · smtp.example.test:587 · TLS on · auth: configured</dd>');
      expect(settings).toContain('<dt>archive</dt><dd>S3-compatible · planted-bucket · https://s3.example.test · credentials: configured</dd>');
      expect(settings).not.toContain('AWS_');
    } finally {
      if (prev.id === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = prev.id;
      if (prev.secret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY; else process.env.AWS_SECRET_ACCESS_KEY = prev.secret;
    }
  });

  it('NO-SECRET, unconfigured: no auth, no AWS env → `not configured` for both; an object-store sender states bucket · prefix · endpoint', async () => {
    const prev = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    try {
      const f = await buildFixture((input) =>
        buildConsoleFacts({
          ...input,
          sender: { kind: 'object-store', options: { bucket: 'deliveries-bucket', endpoint: 'https://minio.example.test' } },
          archive: { kind: 's3', options: { bucket: 'archive-bucket' } },
        }),
      );
      const settings = belowNav((await f.get('/output/settings')).body);
      expect(settings).toContain('<dt>delivery sender</dt><dd>object-store · deliveries-bucket · deliveries/ · https://minio.example.test · credentials: not configured</dd>');
      expect(settings).toContain('<dt>archive</dt><dd>S3-compatible · archive-bucket · — · credentials: not configured</dd>');

      const email = await buildFixture((input) =>
        buildConsoleFacts({ ...input, sender: { kind: 'email', smtp: { host: 'mail.example.test', port: 25 } } }),
      );
      expect(belowNav((await email.get('/output/settings')).body)).toContain('<dd>email · mail.example.test:25 · TLS off · auth: not configured</dd>');
    } finally {
      if (prev.id !== undefined) process.env.AWS_ACCESS_KEY_ID = prev.id;
      if (prev.secret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = prev.secret;
    }
  });

  it('type-level closedness: ConsoleFacts has no credential-shaped key (compile-time lock mirrored from console.ts)', () => {
    expect(consoleFactsIsClosed).toBe(true);
    const facts = buildConsoleFacts({
      sender: { kind: 'email', smtp: { host: 'h', port: 1, auth: { user: PLANTED.smtpUser, pass: PLANTED.smtpPass } } },
      archive: { kind: 'filesystem', archiveDir: '/a' },
      dbPath: '/db',
      backoffPolicy: BACKOFF,
      workerIntervalMs: 1,
      documentTypes: createDocumentTypeRegistry(),
      renderers: RENDERERS,
      defaultRendererId: 'typst',
    });
    const serialized = JSON.stringify(facts);
    for (const secret of SECRET_STRINGS) expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/"[^"]*(pass|secret|token|key)[^"]*":/i);
  });

  it('depth crawl from /output with every group populated: every href resolves 200 and no reachable screen is deeper than 2', async () => {
    const f = await buildFixture();
    f.submitForReview();
    const { jobId } = await f.stuck('ov-crawl-stuck');
    f.backdateJob(jobId);
    f.mintDraft('ov-crawl-draft', true);
    f.seedTrace(await f.poison('ov-crawl-poison'));

    // Structural depth per docs/UI-DESIGN.md: section roots 0, Document
    // detail / review 1, Rule trace 2. Anything else is an unknown screen.
    const depthOf = (href: string): number => {
      const path = href.split('?')[0];
      if ((CONSOLE_SECTION_PATHS as readonly string[]).includes(path)) return 0;
      if (path.startsWith('/output/documents/')) return 1;
      if (/^\/output\/templates\/[^/]+\/[^/]+\/review$/.test(path)) return 1;
      if (path.startsWith('/output/trace/')) return 2;
      throw new Error(`unknown console screen: ${path}`);
    };
    const seen = new Set<string>();
    let frontier = ['/output'];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const href of frontier) {
        if (seen.has(href)) continue;
        seen.add(href);
        const res = await f.get(href);
        expect(res.status, href).toBe(200);
        for (const link of hrefs(res.body)) {
          expect(depthOf(link), link).toBeLessThanOrEqual(2);
          next.push(link);
        }
      }
      frontier = next;
    }
    expect(seen.size).toBeGreaterThan(5);
    expect([...seen].some((h) => h.startsWith('/output/trace/'))).toBe(true);
  });

  it('renderOverviewPage honours an injected `now` (the two threshold groups)', () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    closers.push(() => registryStore.close());
    const { row } = registryStore.mintWithOutbox({ businessObject: 'EKKO', businessObjectId: 'now-1', event: 'e', templateVersion: '1', ruleId: 'r' }, {}, {}, 'purchase-order');
    const at = (ms: number) => belowNav(renderOverviewPage({ registryStore }, new Date(Date.parse(row.createdAt) + ms)));
    expect(at(STRANDED_AFTER_MS - 1)).toBe(ALL_GREEN_BODY);
    expect(at(STRANDED_AFTER_MS)).toContain(`<a href="/output/documents/${row.docId}">`);
  });
});
