/**
 * OutputPort v1 contract tests (GAP-07 closing criterion: "OutputPort v1
 * typed with all five verbs + contract tests; one consumer round-trips
 * them"). Each test pins one verb's contract from the ruling:
 *
 *  - emit → status round-trip returns the SAME docIds (fan-out ⇒ one
 *    DocumentStatus per ruleId), with ownerId never projected.
 *  - preview produces bytes and leaves `listDocuments()` AND the archive
 *    root EMPTY — no registry row, archive, delivery, trace, or docId.
 *  - reproduce returns not-implemented and touches NEITHER the registry
 *    NOR the authorization port (both spied).
 *  - registerDocumentType: duplicate → { status: 'duplicate' }; invalid
 *    definitions → { status: 'invalid', problems } and register nothing.
 *
 * The HTTP consumer round-trip (POST /event, POST /render, GET /documents
 * over `serve()`'s wiring) is the last describe block.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { createRuntimeDeps, registerBuiltinDocumentTypes, type RuntimeDeps } from '../index.js';
import { createIngressServer } from '../server.js';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import type { RegistryStore } from '../registry/registry-store.js';
import { createDefaultAuthorizationPort } from '../authorization/authorization-port.js';
import { createDocumentTypeRegistry } from '../registration/document-type-registry.js';
import { builtinDocumentTypes, invoice } from '../../document-types/index.js';
import { createOutput, type OutputPort } from './create-output.js';
import { sampleBusinessEventKey, validInvoice, validPayslip, validPurchaseOrder, withBusinessEvent } from '../fixtures.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function realDeps(): { deps: RuntimeDeps; archiveDir: string } {
  const root = tempDir('output-port-');
  const archiveDir = join(root, 'archive');
  const deps = createRuntimeDeps(join(root, 'registry.db'), archiveDir, join(root, 'outbox'));
  return { deps, archiveDir };
}

function archivedFiles(archiveDir: string): string[] {
  if (!existsSync(archiveDir)) return [];
  return readdirSync(archiveDir, { recursive: true }).map(String).filter((f) => !f.endsWith('.meta.json'));
}

/** Wrap a RegistryStore so every method call is observable. */
function spyOnEveryMethod(store: RegistryStore): ReturnType<typeof vi.spyOn>[] {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  let proto: object | null = Object.getPrototypeOf(store) as object | null;
  while (proto !== null && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc !== undefined && typeof desc.value === 'function') {
        spies.push(vi.spyOn(store as unknown as Record<string, (...args: unknown[]) => unknown>, name));
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return spies;
}

describe('OutputPort v1 — emit → status', () => {
  it('status(key) returns one DocumentStatus per resolution with the SAME docIds emit minted, never ownerId', async () => {
    const { deps } = realDeps();
    try {
      // invoice.posted fires two rules (default email + fan-out archival copy).
      const businessEvent = sampleBusinessEventKey({ businessObject: 'SalesInvoiceHeader', businessObjectId: 'INV-STATUS-1', event: 'invoice.posted' });
      const emitted = await deps.output.emit({ documentType: 'invoice', payload: validInvoice(), businessEvent });
      expect(emitted.status).toBe('accepted');
      if (emitted.status !== 'accepted') throw new Error('unreachable');
      expect(emitted.resolutions).toHaveLength(2);

      const status = await deps.output.status(businessEvent);
      expect(status.map((s) => s.docId).sort()).toEqual(emitted.resolutions.map((r) => r.docId).sort());
      expect(status.map((s) => s.ruleId).sort()).toEqual(['invoice-archival-copy', 'invoice-default-email']);
      for (const s of status) {
        expect(s).toMatchObject({ documentType: 'invoice', state: 'ORIGINAL', archived: true, templateVersion: '1.0.0' });
        expect(s.rendererVersion).toMatch(/^typst@/);
        expect(typeof s.retentionUntil).toBe('string');
        expect('ownerId' in s).toBe(false);
        expect('archiveRef' in s).toBe(false);
      }
      // One trace per event, on the primary docId only.
      expect(status.filter((s) => s.trace !== undefined)).toHaveLength(1);
      expect(status.find((s) => s.trace !== undefined)?.docId).toBe(emitted.resolutions[0].docId);

      // Unknown key → empty, not an error.
      expect(await deps.output.status({ ...businessEvent, businessObjectId: 'NEVER' })).toEqual([]);
    } finally {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }
  }, 60_000);

  it('a payslip status carries locale and state but no ownerId, even though the registry row has one', async () => {
    const { deps } = realDeps();
    try {
      const businessEvent = { businessObject: 'PAYROLL', businessObjectId: 'PS-STATUS-1', event: 'payslip.issued', templateVersion: '1.0.0' };
      const emitted = await deps.output.emit({
        documentType: 'payslip',
        payload: validPayslip(),
        businessEvent,
        // de-DE: one of the two locales the built-in payslip carries an
        // email message template for (GAP-10) — a locale without one is
        // a loud `unresolved-message-template`, not an accepted emit.
        determination: { locale: 'de-DE', recipients: ['emp@example.com'] },
      });
      expect(emitted.status).toBe('accepted');
      const [row] = deps.registryStore.listByEventKey(businessEvent);
      expect(row.ownerId).toBe('EMP-00042'); // the registry keeps it for authorization…
      const [status] = await deps.output.status(businessEvent);
      expect(status.locale).toBe('de-DE');
      expect(JSON.stringify(status)).not.toContain('EMP-00042'); // …the status projection never exports it.
    } finally {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }
  }, 60_000);
});

describe('OutputPort v1 — preview', () => {
  it('renders bytes and leaves listDocuments() and the archive root EMPTY (no row, no archive, no trace, no docId)', async () => {
    const { deps, archiveDir } = realDeps();
    try {
      const result = await deps.output.preview({ documentType: 'purchase-order', payload: validPurchaseOrder(), templateId: 'po-global-v1' });
      expect(result.status).toBe('rendered');
      if (result.status !== 'rendered') throw new Error('unreachable');
      expect(result.mediaType).toBe('application/pdf');
      expect(result.bytes.byteLength).toBeGreaterThan(1000);
      expect(countPdfPages(result.bytes)).toBeGreaterThanOrEqual(1);
      expect(result.renderer).toMatch(/^typst@/);

      expect(deps.registryStore.listDocuments()).toEqual([]);
      expect(deps.registryStore.listOutboxEntries()).toEqual([]);
      expect(archivedFiles(archiveDir)).toEqual([]);
      expect(deps.deliveryQueue.listJobs({ limit: 10, offset: 0 })).toEqual([]);
    } finally {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }
  }, 60_000);

  it('requires a registered templateId for THIS documentType and never runs determination', async () => {
    const { deps } = realDeps();
    try {
      const wrongType = await deps.output.preview({ documentType: 'purchase-order', payload: validPurchaseOrder(), templateId: 'invoice-global-v1' });
      expect(wrongType).toEqual({ status: 'unknown-template', documentType: 'purchase-order', templateId: 'invoice-global-v1' });
      const missing = await deps.output.preview({ documentType: 'purchase-order', payload: validPurchaseOrder(), templateId: 'nope' });
      expect(missing.status).toBe('unknown-template');
      const unknownType = await deps.output.preview({ documentType: 'delivery-note', payload: {}, templateId: 'x' });
      expect(unknownType.status).toBe('unknown-document-type');
      const invalid = await deps.output.preview({ documentType: 'purchase-order', payload: { ...validPurchaseOrder(), header: {} }, templateId: 'po-global-v1' });
      expect(invalid.status).toBe('invalid-contract');
      // No trace was ever persisted: preview does not determine.
      expect(deps.registryStore.listDocuments()).toEqual([]);
    } finally {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }
  });

  it('a port with no renderer reports render-failed rather than throwing', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore });
    registerBuiltinDocumentTypes(port);
    const result = await port.preview({ documentType: 'purchase-order', payload: validPurchaseOrder(), templateId: 'po-global-v1' });
    expect(result.status).toBe('render-failed');
    registryStore.close();
  });
});

describe('OutputPort v1.1 — reproduce (Stage 5 task 2: live, no longer a stub)', () => {
  // Until Stage 5 task 2 this asserted `not-implemented` and that the
  // registry and authorization port were never touched. Both are now
  // FALSE BY DESIGN (ADR-007 v1.1): `not-implemented` is gone from the
  // union, and reproduce's first act is a registry read followed by
  // `canAccess` — it is that port's first real caller. The full
  // three-path DoD lives in reprint.test.ts; this keeps the v1 contract
  // fact that an UNKNOWN docId is a typed answer that reads the registry
  // once, authorizes nothing (no row to authorize against), writes
  // nothing.
  it('an unknown docId is { status: "unknown-document" } — one registry read, no authorization call, no write', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const registrySpies = spyOnEveryMethod(registryStore);
    const readSpy = vi.spyOn(registryStore, 'getByDocId');
    const writeSpies = (['appendReprintLog', 'mintWithOutbox', 'getOrCreateByResolutionKey', 'updateState'] as const).map((m) =>
      vi.spyOn(registryStore, m),
    );
    const authorization = createDefaultAuthorizationPort(createDocumentTypeRegistry());
    const authzSpy = vi.spyOn(authorization, 'canAccess');
    const port = createOutput({ registryStore, authorization });

    const result = await port.reproduce({ docId: 'any-doc-id', actor: { role: 'hr-clerk', subjectId: 'clerk-1' }, reason: 'audit' });
    expect(result).toEqual({ status: 'unknown-document', docId: 'any-doc-id' });

    expect(authzSpy).not.toHaveBeenCalled();
    expect(readSpy).toHaveBeenCalledTimes(1);
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
    // Nothing but that one read (and its private SELECT helper) ran.
    expect(registrySpies.filter((s) => s.mock.calls.length > 0).length).toBeLessThanOrEqual(2);
    expect(registryStore.listReprintLog('any-doc-id')).toEqual([]);
    registryStore.close();
  });
});

describe('OutputPort v1 — registerDocumentType', () => {
  function bare(): { port: OutputPort; registryStore: RegistryStore } {
    const registryStore = createSqliteRegistryStore(':memory:');
    return { port: createOutput({ registryStore }), registryStore };
  }

  it('registers each built-in once; a second registration is { status: "duplicate" }', () => {
    const { port, registryStore } = bare();
    for (const definition of builtinDocumentTypes) {
      expect(port.registerDocumentType(definition).status).toBe('registered');
    }
    expect(port.registerDocumentType(invoice)).toEqual({ status: 'duplicate', documentType: 'invoice' });
    registryStore.close();
  });

  it('an unregistered type is unknown to emit until it is registered (registration is the only way in)', async () => {
    const { port, registryStore } = bare();
    const businessEvent = sampleBusinessEventKey();
    expect((await port.emit({ documentType: 'purchase-order', payload: validPurchaseOrder(), businessEvent })).status).toBe('unknown-document-type');
    registerBuiltinDocumentTypes(port);
    expect((await port.emit({ documentType: 'purchase-order', payload: validPurchaseOrder(), businessEvent })).status).toBe('accepted');
    registryStore.close();
  });

  it('rejects a rule whose documentType differs from the definition, registering nothing', () => {
    const { port, registryStore } = bare();
    const result = port.registerDocumentType({
      ...invoice,
      rules: [...invoice.rules, { id: 'stray', conditions: { documentType: 'purchase-order' }, resolution: { channel: 'email' } }],
    });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    expect(result.problems.some((p) => p.path.startsWith('rules[') && p.message.includes('stray'))).toBe(true);
    // Nothing registered — a retry with the fix succeeds (no phantom $id, no half-state).
    expect(port.registerDocumentType(invoice).status).toBe('registered');
    registryStore.close();
  });

  it('rejects a template id already registered under ANOTHER document type', () => {
    const { port, registryStore } = bare();
    expect(port.registerDocumentType(invoice).status).toBe('registered');
    const result = port.registerDocumentType({
      documentType: 'memo-clash',
      contract: { type: 'object' },
      templates: [{ meta: { ...invoice.templates[0].meta, variant: { documentType: 'memo-clash' } }, content: invoice.templates[0].content }],
      rules: [],
    });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    expect(result.problems[0].message).toContain('invoice-global-v1');
    registryStore.close();
  });

  it('rejects a contract that fails to compile under strict mode', () => {
    const { port, registryStore } = bare();
    const result = port.registerDocumentType({
      documentType: 'broken',
      contract: { type: 'object', properties: { a: { type: 'strin' } } },
      templates: [],
      rules: [],
    });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    expect(result.problems[0].path).toBe('contract');
    registryStore.close();
  });

  it('GAP-17: rejects a non-positive/non-integer retentionYears or an ownerIdPath outside the frozen grammar, atomically', () => {
    const { port, registryStore } = bare();
    for (const retentionYears of [0, -3, 2.5, Number.NaN]) {
      const result = port.registerDocumentType({ ...invoice, retentionYears });
      expect(result.status).toBe('invalid');
      if (result.status !== 'invalid') throw new Error('unreachable');
      expect(result.problems).toEqual([{ path: 'retentionYears', message: expect.stringContaining('positive integer') }]);
    }
    for (const ownerIdPath of ['', 'header.employeeId.', 'header[0]', 'lines.*.id', '$.header']) {
      const result = port.registerDocumentType({ ...invoice, ownerIdPath });
      expect(result.status).toBe('invalid');
      if (result.status !== 'invalid') throw new Error('unreachable');
      expect(result.problems.map((p) => p.path)).toEqual(['ownerIdPath']);
    }
    // Nothing registered by any rejection — the corrected definition still succeeds.
    expect(port.registerDocumentType({ ...invoice, retentionYears: 7, ownerIdPath: 'header.buyer.contactId' }).status).toBe('registered');
    registryStore.close();
  });
});

describe('OutputPort v1 — the consumer round-trip over serve()\'s HTTP wiring', () => {
  it('POST /event → emit, GET /documents → status, POST /render → preview, on one port', async () => {
    const { deps, archiveDir } = realDeps();
    const server = createIngressServer({
      output: deps.output,
      registryStore: deps.registryStore,
      composition: deps.composition,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const businessEvent = sampleBusinessEventKey({ businessObjectId: 'HTTP-RT-1' });
      const eventRes = await fetch(`${baseUrl}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withBusinessEvent(validPurchaseOrder(), businessEvent)),
      });
      expect(eventRes.status).toBe(202);
      const event = (await eventRes.json()) as { docId: string; resolutions: Array<{ docId: string }> };

      const q = new URLSearchParams(businessEvent as unknown as Record<string, string>);
      const docsRes = await fetch(`${baseUrl}/documents?${q}`);
      expect(docsRes.status).toBe(200);
      const docs = (await docsRes.json()) as { businessEvent: unknown; documents: Array<{ docId: string; archived: boolean }> };
      expect(docs.businessEvent).toEqual(businessEvent);
      expect(docs.documents.map((d) => d.docId)).toEqual(event.resolutions.map((r) => r.docId));
      expect(docs.documents[0].archived).toBe(true);
      expect(JSON.stringify(docs)).not.toContain('ownerId');

      const missingKey = await fetch(`${baseUrl}/documents?businessObject=PurchaseOrderHeader`);
      expect(missingKey.status).toBe(400);

      const archivedBefore = archivedFiles(archiveDir).length;
      const rowsBefore = deps.registryStore.listDocuments().length;
      const renderRes = await fetch(`${baseUrl}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validPurchaseOrder(), templateId: 'po-global-v1' }),
      });
      expect(renderRes.status).toBe(200);
      expect(renderRes.headers.get('content-type')).toBe('application/pdf');
      expect(renderRes.headers.get('x-renderer')).toMatch(/^typst@/);
      const pdf = new Uint8Array(await renderRes.arrayBuffer());
      expect(countPdfPages(pdf)).toBeGreaterThanOrEqual(1);
      expect(archivedFiles(archiveDir).length).toBe(archivedBefore);
      expect(deps.registryStore.listDocuments().length).toBe(rowsBefore);

      const noTemplate = await fetch(`${baseUrl}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPurchaseOrder()),
      });
      expect(noTemplate.status).toBe(400);
      expect(((await noTemplate.json()) as { type: string }).type).toContain('missing-template-id');
      const badTemplate = await fetch(`${baseUrl}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validPurchaseOrder(), templateId: 'nope' }),
      });
      expect(badTemplate.status).toBe(404);
      expect(((await badTemplate.json()) as { type: string }).type).toContain('unknown-template');
      expect((await fetch(`${baseUrl}/render`)).status).toBe(405);
      expect((await fetch(`${baseUrl}/documents`, { method: 'POST' })).status).toBe(405);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }
  }, 60_000);
});
