/**
 * Console screens (ROADMAP Stage 3 "Minimal console, read-only"): real HTTP
 * requests against `createIngressServer()`, matching server.test.ts's
 * pattern — no fixture bypassing the real route.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngressServer } from './index.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import type { RegistryStore } from './registry/registry-store.js';
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
