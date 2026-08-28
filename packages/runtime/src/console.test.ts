/**
 * Console screens (ROADMAP Stage 3 "Minimal console, read-only"): real HTTP
 * requests against `createIngressServer()`, matching server.test.ts's
 * pattern — no fixture bypassing the real route.
 */
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createIngressServer } from './index.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import type { RegistryStore } from './registry/registry-store.js';
import { FsArchiveStore } from './archive/fs-archive-store.js';
import { archiveArtifact } from './archive/index.js';
import { DEFAULT_BACKOFF_POLICY, SqliteDeliveryQueue } from './delivery/index.js';
import type { ChannelSender } from './delivery/channel-sender.js';
import { sampleBusinessEventKey, validPurchaseOrder, withBusinessEvent } from './fixtures.js';

describe('console (read-only): /output/documents, /output/documents/:docId, /output/trace/:id', () => {
  let baseUrl: string;
  let registryStore: RegistryStore;
  let server: ReturnType<typeof createIngressServer>;

  beforeAll(async () => {
    registryStore = createSqliteRegistryStore(':memory:');
    server = createIngressServer({ registryStore });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    registryStore.close();
  });

  async function post(body: unknown) {
    const res = await fetch(`${baseUrl}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  async function getHtml(path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, contentType: res.headers.get('content-type'), body: await res.text() };
  }

  it('Registry screen (GET /output/documents) renders a real minted document row, linked to its detail page', async () => {
    const { status, json } = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'console-registry-1' })),
    );
    expect(status).toBeLessThan(300);
    const docId = json.docId as string;

    const { status: htmlStatus, contentType, body } = await getHtml('/output/documents');
    expect(htmlStatus).toBe(200);
    expect(contentType).toContain('text/html');
    expect(body).toContain(docId);
    expect(body).toContain(`/output/documents/${docId}`);
  });

  it('Registry screen search box filters server-side by businessObjectId', async () => {
    const { json } = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'console-registry-needle' })),
    );
    const docId = json.docId as string;

    const { body: matched } = await getHtml('/output/documents?q=console-registry-needle');
    expect(matched).toContain(docId);

    const { body: unmatched } = await getHtml('/output/documents?q=totally-unrelated-search-term');
    expect(unmatched).not.toContain(docId);
  });

  it('Document detail (GET /output/documents/:docId) renders identity facts, delivery history, the reprint trichotomy, and a trace link', async () => {
    const { json } = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'console-detail-1' })),
    );
    const docId = json.docId as string;

    const { status, contentType, body } = await getHtml(`/output/documents/${docId}`);
    expect(status).toBe(200);
    expect(contentType).toContain('text/html');
    expect(body).toContain(docId);
    expect(body).toContain('EKKO');
    expect(body).toContain('console-detail-1');
    expect(body).toContain('po.released');
    // inputHash/outputHash/rendererVersion are genuinely null this task — must render "—", never be hidden or fabricated.
    expect(body).toContain('—');
    // No composition deps supplied to this server -> nothing archived -> the exact retentionUntil phrasing.
    expect(body).toContain('not yet archived');
    expect(body).toContain('PDF/A-2b · veraPDF-verified in CI');
    // Reprint trichotomy: exact UI-DESIGN.md one-line descriptions, each "— not yet available in this console".
    expect(body).toContain('Reproduce (archive bytes, stamped) — not yet available in this console');
    expect(body).toContain('Regenerate (current template+data, new doc) — not yet available in this console');
    expect(body).toContain('Reissue (new event) — not yet available in this console');
    // A matched event's determine() call is persisted under its primary docId -> a trace link must be present.
    expect(body).toContain(`/output/trace/${docId}`);
  });

  it('Document detail 404s (problem+json) for an unknown docId', async () => {
    const res = await fetch(`${baseUrl}/output/documents/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const json = await res.json();
    expect(json.type).toContain('not-found');
  });

  it('Rule trace screen (GET /output/trace/:id) renders the persisted DeterminationTrace: header, rule rows with anchors, resolution blocks', async () => {
    const { json } = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'console-trace-1' })),
    );
    const docId = json.docId as string;
    const determination = json.determination as { ruleId: string; templateId: string };

    const { status, contentType, body } = await getHtml(`/output/trace/${docId}`);
    expect(status).toBe(200);
    expect(contentType).toContain('text/html');
    expect(body).toContain('purchase-order');
    expect(body).toContain('EKKO');
    expect(body).toContain('po.released');
    expect(body).toContain('matched');
    // The firing rule's row carries an anchor id the resolution block links back to.
    expect(body).toContain(`id="rule-${determination.ruleId}"`);
    expect(body).toContain(`href="#rule-${determination.ruleId}"`);
    expect(body).toContain(determination.templateId);
  });

  it('Rule trace 404s (problem+json) for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/output/trace/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('payslip lock glyph is shown for a payslip row and withheld for a non-payslip row', async () => {
    // Constructed directly via the registry store's mint APIs — no real
    // payslip template exists yet (composition.ts: purchase-order only),
    // so this is the only way to exercise the gating honestly.
    const payslip = registryStore.getOrCreateByResolutionKey(
      {
        businessObject: 'PSLIP',
        businessObjectId: 'console-payslip-lock',
        event: 'payslip.issued',
        templateVersion: '1.0.0',
        ruleId: 'manual-test-rule',
      },
      'payslip',
    );

    const { json } = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'console-po-no-lock' })),
    );
    const poDocId = json.docId as string;

    const { body } = await getHtml('/output/documents?q=console-');
    const payslipRowStart = body.indexOf(payslip.row.docId);
    const payslipRowEnd = body.indexOf('</li>', payslipRowStart);
    expect(body.slice(payslipRowStart, payslipRowEnd)).toContain('🔒');

    const poRowStart = body.indexOf(poDocId);
    const poRowEnd = body.indexOf('</li>', poRowStart);
    expect(body.slice(poRowStart, poRowEnd)).not.toContain('🔒');
  });
});

describe('Operations screen (GET /output/operations) and its poison cross-links', () => {
  const tempDirs: string[] = [];
  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  class AlwaysFailingSender implements ChannelSender {
    async send(): Promise<void> {
      throw new Error('channel is dead (simulated)');
    }
  }
  class AlwaysSucceedingSender implements ChannelSender {
    async send(): Promise<void> {
      // no-op
    }
  }

  async function buildFixture() {
    const dbDir = tempDir('console-ops-db-');
    const dbPath = join(dbDir, 'registry.db');
    const archiveRoot = tempDir('console-ops-archive-');

    const registryStore = createSqliteRegistryStore(dbPath);
    const archiveStore = new FsArchiveStore(archiveRoot);
    const backoffPolicy = { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 };
    const deliveryQueue = new SqliteDeliveryQueue(dbPath, {
      registryStore,
      archiveStore,
      backoffPolicy,
      onPoisonAlert: () => {},
    });

    async function mintArchivedDoc(businessObjectId: string): Promise<string> {
      const { row } = registryStore.getOrCreateByEventKey({
        businessObject: 'EKKO',
        businessObjectId,
        event: 'po.released',
        templateVersion: '1.0.0',
      });
      await archiveArtifact({
        archiveStore,
        registryStore,
        docId: row.docId,
        bytes: new TextEncoder().encode('%PDF-1.7 fake bytes'),
        mediaType: 'application/pdf',
        retentionUntil: '2030-01-01T00:00:00Z',
      });
      return row.docId;
    }

    // Poison job: drives 2 failing attempts (maxAttempts: 2) to poison.
    const poisonDocId = await mintArchivedDoc('ops-poison-1');
    const poisonJob = deliveryQueue.enqueue({ docId: poisonDocId, channel: 'email', recipients: ['a@example.com', 'b@example.com'] });
    await deliveryQueue.attemptDelivery(poisonJob.id, new AlwaysFailingSender());
    const poisonResult = await deliveryQueue.attemptDelivery(poisonJob.id, new AlwaysFailingSender());
    expect(poisonResult.outcome).toBe('poisoned');

    // Delivered job: pure noise on the default (no-q) view.
    const deliveredDocId = await mintArchivedDoc('ops-delivered-1');
    const deliveredJob = deliveryQueue.enqueue({ docId: deliveredDocId, channel: 'email', recipients: ['c@example.com'] });
    await deliveryQueue.attemptDelivery(deliveredJob.id, new AlwaysSucceedingSender());

    // Untouched pending job.
    const pendingDocId = await mintArchivedDoc('ops-pending-1');
    deliveryQueue.enqueue({ docId: pendingDocId, channel: 'webhook', recipients: ['d@example.com'] });

    const server = createIngressServer({ registryStore, deliveryQueue, backoffPolicy });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    return { registryStore, deliveryQueue, server, baseUrl, poisonDocId, deliveredDocId, pendingDocId };
  }

  async function getHtml(baseUrl: string, path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, contentType: res.headers.get('content-type'), body: await res.text() };
  }

  it('with no q: shows pending/in_progress/poison, hides delivered (quiet when green)', async () => {
    const { registryStore, deliveryQueue, server, baseUrl, poisonDocId, deliveredDocId, pendingDocId } = await buildFixture();

    const { status, contentType, body } = await getHtml(baseUrl, '/output/operations');
    expect(status).toBe(200);
    expect(contentType).toContain('text/html');
    expect(body).toContain(poisonDocId);
    expect(body).toContain(pendingDocId);
    expect(body).not.toContain(deliveredDocId);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    deliveryQueue.close();
    registryStore.close();
  });

  it('with q: includes delivered too (a poison cross-link should not hide a later success)', async () => {
    const { registryStore, deliveryQueue, server, baseUrl, deliveredDocId } = await buildFixture();

    const { body } = await getHtml(baseUrl, `/output/operations?q=${deliveredDocId}`);
    expect(body).toContain(deliveredDocId);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    deliveryQueue.close();
    registryStore.close();
  });

  it('poison row shows recipient COUNT only (never raw addresses), inert retry text, and attempt/maxAttempts from the injected BackoffPolicy', async () => {
    const { registryStore, deliveryQueue, server, baseUrl, poisonDocId } = await buildFixture();

    const { body } = await getHtml(baseUrl, '/output/operations');
    const occurrence = body.indexOf(poisonDocId);
    const rowStart = body.lastIndexOf('<li class="row">', occurrence);
    const rowEnd = body.indexOf('</li>', occurrence);
    const row = body.slice(rowStart, rowEnd);

    expect(row).toContain('2 recipient(s)');
    expect(row).not.toContain('a@example.com');
    expect(row).not.toContain('b@example.com');
    expect(row).toContain('poison');
    expect(row).toContain('Retry — not yet available in this console');
    // backoffPolicy.maxAttempts is 2 (this fixture), never the module's
    // DEFAULT_BACKOFF_POLICY.maxAttempts (5).
    expect(row).toContain('attempt 2/2');
    expect(DEFAULT_BACKOFF_POLICY.maxAttempts).not.toBe(2);

    // docId links back to Document detail (reverse cross-link).
    expect(row).toContain(`/output/documents/${poisonDocId}`);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    deliveryQueue.close();
    registryStore.close();
  });

  it('Registry row cross-links to Operations when its last delivery event is poisoned', async () => {
    const { registryStore, deliveryQueue, server, baseUrl, poisonDocId } = await buildFixture();

    const { body } = await getHtml(baseUrl, `/output/documents?q=${poisonDocId}`);
    const rowStart = body.indexOf(poisonDocId);
    const rowEnd = body.indexOf('</li>', rowStart);
    const row = body.slice(rowStart, rowEnd);
    expect(row).toContain(`/output/operations?q=${poisonDocId}`);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    deliveryQueue.close();
    registryStore.close();
  });

  it('Document detail cross-links to Operations when it has a poisoned delivery event', async () => {
    const { registryStore, deliveryQueue, server, baseUrl, poisonDocId, pendingDocId } = await buildFixture();

    const { body: poisonBody } = await getHtml(baseUrl, `/output/documents/${poisonDocId}`);
    expect(poisonBody).toContain(`/output/operations?q=${poisonDocId}`);

    const { body: pendingBody } = await getHtml(baseUrl, `/output/documents/${pendingDocId}`);
    expect(pendingBody).not.toContain('/output/operations?q=');

    await new Promise<void>((resolve) => server.close(() => resolve()));
    deliveryQueue.close();
    registryStore.close();
  });

  it('/output/operations 404s when the server has no deliveryQueue wired (composition-optional, like /output/documents)', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const server = createIngressServer({ registryStore });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/output/operations`);
    expect(res.status).toBe(404);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    registryStore.close();
  });
});
