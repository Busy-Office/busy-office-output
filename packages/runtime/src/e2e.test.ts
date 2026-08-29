/**
 * End-to-end test for ROADMAP Stage 3's "Single-process serve" task — this
 * IS the Stage 3 exit gate, exercised on the single-process wiring:
 * "Event → rule trace → render → email → archived artifact → complete
 * audit trail, demonstrated end-to-end in under two minutes."
 *
 * Drives a real HTTP POST through `createIngressServer` wired with the
 * SAME backends `serve()` (index.ts) uses in production —
 * `createRuntimeDeps`, real `TypstRenderer`, real `typst compile` (no
 * mocking of rendering/archiving) — then drains the delivery queue
 * deterministically via `drainOnce` (no timers, no racing a real interval;
 * see worker.ts's header comment) instead of waiting on `startWorker`'s
 * setInterval loop.
 *
 * Originally covered both halves of the Stage 3 arb-chair ruling: purchase-
 * order rendered, invoice was honestly content-less. ROADMAP Stage 4
 * ("Invoice: tax/multi-currency contract + template") wired real content
 * for `invoice-global-v1` (packages/runtime/src/render/template-content.ts,
 * tree reused verbatim from test/corpus/invoice/template.ts) — invoice now
 * renders, archives, and delivers exactly like purchase-order below.
 * payslip (`payslip-global-v1`) remains the one documentType still on the
 * honest `'no-template-content'` path, deferred to its own Stage 4 task.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { countPdfPages, verifyPdfA } from '@busy-office/render-typst';
import { createIngressServer } from './server.js';
import { createRuntimeDeps, type RuntimeDeps } from './index.js';
import { drainOnce } from './worker.js';
import { sampleBusinessEventKey, validInvoice, validPayslip, validPurchaseOrder, withBusinessEvent } from './fixtures.js';

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

describe('single-process serve: event -> rule trace -> render -> archive -> delivery -> audit trail', () => {
  let deps: RuntimeDeps;
  let outboxDir: string;
  let server: ReturnType<typeof createIngressServer>;
  let baseUrl: string;

  beforeAll(async () => {
    const dbDir = tempDir('e2e-registry-');
    outboxDir = tempDir('e2e-outbox-');
    deps = createRuntimeDeps(join(dbDir, 'registry.db'), tempDir('e2e-archive-'), outboxDir);
    server = createIngressServer({
      idempotencyStore: deps.idempotencyStore,
      registryStore: deps.registryStore,
      composition: deps.composition,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    deps.deliveryQueue.close();
    deps.registryStore.close();
  });

  async function post(body: unknown) {
    const res = await fetch(`${baseUrl}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it(
    'purchase-order: rule trace present, real PDF rendered + archived, delivered via the FS outbox, full audit trail',
    async () => {
      const payload = withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey());

      const { status, json } = await post(payload);
      expect(status).toBe(202);

      // Rule trace present (HLD §9: TRACE mandatory on every determination).
      expect(json.trace).toMatchObject({ outcome: 'matched' });
      expect(Array.isArray(json.trace.rules)).toBe(true);
      expect(json.trace.rules.length).toBeGreaterThan(0);

      const docId: string = json.docId;
      expect(typeof docId).toBe('string');

      const [resolution] = json.resolutions;
      expect(resolution.composition).toMatchObject({ outcome: 'rendered' });
      const archiveRef: string = resolution.composition.archiveRef;
      const deliveryJobId: number = resolution.composition.deliveryJobId;
      expect(typeof archiveRef).toBe('string');
      expect(typeof resolution.composition.retentionUntil).toBe('string');

      // Real render actually happened: archived bytes are a real, multi-object PDF.
      const archivedBytes = await deps.archiveStore.retrieve(archiveRef);
      expect(archivedBytes.length).toBeGreaterThan(0);
      expect(Buffer.from(archivedBytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
      expect(countPdfPages(archivedBytes)).toBeGreaterThanOrEqual(1);

      // Registry row tells a coherent state story: DRAFT -> ORIGINAL, archiveRef + retentionUntil recorded.
      const row = deps.registryStore.getByDocId(docId);
      expect(row).toBeDefined();
      expect(row?.state).toBe('ORIGINAL');
      expect(row?.archiveRef).toBe(archiveRef);
      expect(row?.retentionUntil).toBe(resolution.composition.retentionUntil);
      // GAP-15: the audit row names the renderer that produced the bytes,
      // derived from the real TypstRenderer instance (not a hardcoded string).
      const typst = deps.composition.renderer;
      expect(typst.id).toBe('typst');
      expect(row?.rendererVersion).toBe(`typst@${typst.version}`);

      // Delivery was enqueued, not yet attempted.
      const jobBeforeDrain = deps.deliveryQueue.getJob(deliveryJobId);
      expect(jobBeforeDrain?.status).toBe('pending');

      // Worker loop, driven deterministically (drainOnce, not the real
      // interval — see worker.ts): attempts the queued delivery via the
      // real FsChannelSender.
      const attempts = await drainOnce(deps.deliveryQueue, deps.channelSender);
      expect(attempts.length).toBeGreaterThanOrEqual(1);
      const thisAttempt = attempts.find((a) => a.job.id === deliveryJobId);
      expect(thisAttempt?.outcome).toBe('delivered');

      // Complete audit trail: delivery_history carries the attempt.
      const rowAfterDelivery = deps.registryStore.getByDocId(docId);
      expect(rowAfterDelivery?.deliveryHistory.length).toBeGreaterThanOrEqual(1);
      const deliveredEvent = rowAfterDelivery?.deliveryHistory.find((e) => e.status === 'delivered');
      expect(deliveredEvent).toMatchObject({ channel: resolution.channel, status: 'delivered' });

      const job = deps.deliveryQueue.getJob(deliveryJobId);
      expect(job?.status).toBe('delivered');
    },
    30_000,
  );

  it(
    'invoice: fan-out resolutions each get a rule trace + docId, and now render + archive for real (Stage 4)',
    async () => {
      const payload = withBusinessEvent(
        validInvoice(),
        sampleBusinessEventKey({ businessObject: 'RBKP', businessObjectId: '190000111', event: 'invoice.posted' }),
      );

      const { status, json } = await post(payload);
      expect(status).toBe(202);
      expect(json.trace).toMatchObject({ outcome: 'matched' });

      expect(json.resolutions.length).toBeGreaterThanOrEqual(1);
      for (const resolution of json.resolutions) {
        expect(resolution.composition).toMatchObject({ outcome: 'rendered' });
        const archiveRef: string = resolution.composition.archiveRef;
        expect(typeof archiveRef).toBe('string');

        const archivedBytes = await deps.archiveStore.retrieve(archiveRef);
        expect(archivedBytes.length).toBeGreaterThan(0);
        expect(Buffer.from(archivedBytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
        expect(countPdfPages(archivedBytes)).toBeGreaterThanOrEqual(1);

        const row = deps.registryStore.getByDocId(resolution.docId);
        expect(row?.state).toBe('ORIGINAL');
        expect(row?.archiveRef).toBe(archiveRef);
      }
    },
    30_000,
  );

  it('outbox file for a delivered purchase-order is byte-identical to the archived artifact', async () => {
    const payload = withBusinessEvent(
      validPurchaseOrder(),
      sampleBusinessEventKey({ businessObjectId: '4500009999' }),
    );
    const { json } = await post(payload);
    const [resolution] = json.resolutions;
    const archiveRef: string = resolution.composition.archiveRef;

    await drainOnce(deps.deliveryQueue, deps.channelSender);

    const archivedBytes = Buffer.from(await deps.archiveStore.retrieve(archiveRef));

    const channelDir = join(outboxDir, resolution.channel);
    const files = readdirSync(channelDir).filter((f) => f.startsWith(json.docId) && f.endsWith('.bin'));
    expect(files.length).toBe(1);
    const outboxBytes = readFileSync(join(channelDir, files[0]));

    expect(Buffer.compare(archivedBytes, outboxBytes)).toBe(0);
  });

  it(
    'payslip for companyCode 1000 routes to pdf-direct (ADR-002): one page, PDF/A-2b per veraPDF, archived + delivered',
    async () => {
      // `determination.companyCode` (server.ts's optional routing-hint
      // envelope field) resolves the most-specific variant —
      // packages/runtime/rules/templates/payslip-companyCode-1000.json,
      // `"renderer": "pdf-direct"` — the one real template on the second
      // renderer. Same pipeline, same archive, same delivery; only the
      // Renderer implementation differs, selected per template.
      const payload = {
        ...withBusinessEvent(
          validPayslip(),
          sampleBusinessEventKey({ businessObject: 'PSLIP', businessObjectId: 'PS-000789-1000', event: 'payslip.issued' }),
        ),
        determination: { companyCode: '1000', recipients: ['emp-0000789@example.com'] },
      };
      const { status, json } = await post(payload);
      expect(status).toBe(202);
      expect(json.trace).toMatchObject({ outcome: 'matched' });

      const [resolution] = json.resolutions;
      expect(resolution.templateId).toBe('payslip-companyCode-1000-v1');
      expect(resolution.renderer).toBe('pdf-direct');
      expect(resolution.composition).toMatchObject({ outcome: 'rendered' });

      const archivedBytes = await deps.archiveStore.retrieve(resolution.composition.archiveRef);
      expect(countPdfPages(archivedBytes)).toBe(1);
      // pdf-direct's own producer string proves which renderer actually produced the archived bytes.
      expect(Buffer.from(archivedBytes).includes(Buffer.from('busy-office-output pdf-direct'))).toBe(true);
      const pdfa = await verifyPdfA(archivedBytes, '2b');
      expect(pdfa.failures).toEqual([]);
      expect(pdfa.compliant).toBe(true);

      // GAP-15: the registry row carries pdf-direct's id@version — a value
      // different from the Typst row above, read off the real renderer.
      const pdfDirect = deps.composition.renderers?.['pdf-direct'];
      expect(pdfDirect?.id).toBe('pdf-direct');
      const row = deps.registryStore.getByDocId(json.docId as string);
      expect(row?.rendererVersion).toBe(`pdf-direct@${pdfDirect?.version}`);
      expect(row?.rendererVersion).not.toBe(`typst@${deps.composition.renderer.version}`);

      const attempts = await drainOnce(deps.deliveryQueue, deps.channelSender);
      expect(attempts.find((a) => a.job.id === resolution.composition.deliveryJobId)?.outcome).toBe('delivered');
    },
    30_000,
  );

  it('payslip without a companyCode still resolves payslip-global-v1 on typst (the routing rule is per template, not per document type)', async () => {
    const payload = {
      ...withBusinessEvent(
        validPayslip(),
        sampleBusinessEventKey({ businessObject: 'PSLIP', businessObjectId: 'PS-000789-global', event: 'payslip.issued' }),
      ),
      determination: { recipients: ['emp-0000789@example.com'] },
    };
    const { status, json } = await post(payload);
    expect(status).toBe(202);
    const [resolution] = json.resolutions;
    expect(resolution.templateId).toBe('payslip-global-v1');
    expect(resolution.renderer).toBe('typst');
    expect(resolution.composition).toMatchObject({ outcome: 'rendered' });
  }, 30_000);
});
