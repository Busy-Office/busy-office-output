/**
 * GAP-26: Document detail's reprint trichotomy — `reproduce` gains a real
 * console control (`GET /output/documents/:docId/reproduce`); `regenerate`
 * and `reissue` stay inert text (ERP-caller-only, architecturally — the
 * registry holds no payload for an operator to supply, HLD §1).
 *
 * Real HTTP against `createIngressServer` (server.ts), a real `FsArchiveStore`,
 * and the built-in document types (`registerBuiltinDocumentTypes`) — no
 * rendering (bytes are minted directly via `archiveArtifact`, the same
 * shortcut `overview-settings.test.ts` uses), so this stays fast while every
 * check still goes through `OutputPort.reproduce` for real.
 *
 * No payload is ever logged; a planted marker (standing in for a payslip
 * recipient/name) is asserted absent from every refusal body.
 */
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIngressServer } from './server.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import type { RegistryStore } from './registry/registry-store.js';
import { FsArchiveStore } from './archive/fs-archive-store.js';
import { archiveArtifact } from './archive/index.js';
import { createOutput } from './embed/create-output.js';
import { createDocumentTypeRegistry } from './registration/document-type-registry.js';
import { registerBuiltinDocumentTypes } from './index.js';

const PLANTED_MARKER = 'PLANTED-PAYSLIP-RECIPIENT-6f2c1a';

describe('GET /output/documents/:docId/reproduce (GAP-26)', () => {
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

  async function buildFixture() {
    const registryStore: RegistryStore = createSqliteRegistryStore(':memory:');
    const archiveStore = new FsArchiveStore(tempDir('reproduce-archive-'));
    const documentTypes = createDocumentTypeRegistry();
    const output = createOutput({ registryStore, archiveStore, documentTypes });
    registerBuiltinDocumentTypes(output);
    const server = createIngressServer({ registryStore, documentTypes, output });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closers.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      registryStore.close();
    });

    let seq = 0;
    /** Mints an ARCHIVED row directly (no render) — a fake-but-marked PDF. */
    async function mintArchived(documentType: string, ownerId?: string): Promise<{ docId: string; bytes: Uint8Array }> {
      seq += 1;
      const { row } = registryStore.getOrCreateByResolutionKey(
        { businessObject: 'OBJ', businessObjectId: `id-${seq}`, event: 'issued', templateVersion: '1.0.0', ruleId: `r${seq}` },
        documentType,
        ownerId,
      );
      const bytes = new TextEncoder().encode(`%PDF-1.7 fake ${PLANTED_MARKER}-${seq}`);
      await archiveArtifact({
        archiveStore,
        registryStore,
        docId: row.docId,
        bytes,
        mediaType: 'application/pdf',
        retentionUntil: '2030-01-01T00:00:00Z',
        renderer: { id: 'typst', version: '0.15.1' },
      });
      return { docId: row.docId, bytes };
    }
    /** Mints a DRAFT row — never archived. */
    function mintDraft(documentType: string): string {
      seq += 1;
      const { row } = registryStore.getOrCreateByResolutionKey(
        { businessObject: 'OBJ', businessObjectId: `draft-${seq}`, event: 'issued', templateVersion: '1.0.0', ruleId: `d${seq}` },
        documentType,
      );
      return row.docId;
    }

    async function reproduce(docId: string, opts: { reason?: string; subject?: string; role?: string } = {}) {
      const query = opts.reason !== undefined ? `?reason=${encodeURIComponent(opts.reason)}` : '';
      const headers: Record<string, string> = {};
      if (opts.subject !== undefined) headers['X-Actor-Subject'] = opts.subject;
      if (opts.role !== undefined) headers['X-Actor-Role'] = opts.role;
      const res = await fetch(`${baseUrl}/output/documents/${encodeURIComponent(docId)}/reproduce${query}`, { headers, redirect: 'manual' });
      const buf = new Uint8Array(await res.arrayBuffer());
      return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        contentDisposition: res.headers.get('content-disposition'),
        bytes: buf,
        bodyText: (() => {
          try {
            return new TextDecoder('utf-8', { fatal: false }).decode(buf);
          } catch {
            return '';
          }
        })(),
      };
    }
    async function detail(docId: string) {
      const res = await fetch(`${baseUrl}/output/documents/${encodeURIComponent(docId)}`);
      return { status: res.status, body: await res.text() };
    }

    return { registryStore, archiveStore, mintArchived, mintDraft, reproduce, detail };
  }

  it('valid actor + reason: 200, correct headers, byte-identical body, one reprint_log row', async () => {
    const f = await buildFixture();
    const { docId, bytes } = await f.mintArchived('purchase-order');

    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
    const res = await f.reproduce(docId, { reason: 'console reproduce', subject: 'ops-1', role: 'console' });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/pdf');
    expect(res.contentDisposition).toBe(`attachment; filename="${docId}.pdf"`);
    expect(res.bytes).toEqual(bytes);

    const log = f.registryStore.listReprintLog(docId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ docId, action: 'reproduce', actorSubjectId: 'ops-1', resultDocId: null });
  });

  it('missing actor subject: 400, nothing logged', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('purchase-order');

    const res = await f.reproduce(docId, { reason: 'audit' }); // no subject header
    expect(res.status).toBe(400);
    expect(res.bodyText).toContain('Actor required');
    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
  });

  it('missing reason: 400, nothing logged', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('purchase-order');

    const res = await f.reproduce(docId, { subject: 'ops-1' }); // no reason
    expect(res.status).toBe(400);
    expect(res.bodyText).toContain('Reason required');
    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
  });

  it('wrong-owner actor on an owner-scoped (payslip) document: 403, no log row, archive never read', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('payslip', 'E1');
    const retrieveSpy = vi.spyOn(f.archiveStore, 'retrieve');

    const res = await f.reproduce(docId, { reason: 'peeking', subject: 'E2', role: 'employee' });
    expect(res.status).toBe(403);
    expect(res.bodyText).not.toContain(PLANTED_MARKER);
    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
    expect(retrieveSpy).not.toHaveBeenCalled();
  });

  it('unknown docId: 404', async () => {
    const f = await buildFixture();
    const res = await f.reproduce('does-not-exist', { reason: 'audit', subject: 'ops-1' });
    expect(res.status).toBe(404);
    expect(res.bodyText).not.toContain(PLANTED_MARKER);
  });

  it('purged document: 410, no bytes in the body', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('purchase-order');
    f.registryStore.markPurged(docId, '2026-01-01T00:00:00Z');

    const res = await f.reproduce(docId, { reason: 'audit', subject: 'ops-1' });
    expect(res.status).toBe(410);
    expect(res.bodyText).toContain('2026-01-01T00:00:00Z');
    expect(res.bodyText).not.toContain(PLANTED_MARKER);
    expect(res.contentDisposition).toBeNull();
  });

  it('not-yet-archived (DRAFT) document: 409, no bytes', async () => {
    const f = await buildFixture();
    const docId = f.mintDraft('purchase-order');

    const res = await f.reproduce(docId, { reason: 'audit', subject: 'ops-1' });
    expect(res.status).toBe(409);
    expect(res.contentDisposition).toBeNull();
  });

  it('Document detail: Reproduce is a real link; Regenerate/Reissue stay plain text', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('purchase-order');
    const { status, body } = await f.detail(docId);
    expect(status).toBe(200);

    const reproduceHref = `/output/documents/${docId}/reproduce?reason=${encodeURIComponent('console reproduce')}`;
    expect(body).toContain(`<a href="${reproduceHref}">Reproduce</a>`);

    // Regenerate/Reissue: text present, but never inside an <a href=...> anchor.
    expect(body).toContain('Regenerate (current template+data, new doc)');
    expect(body).toContain('Reissue (new event)');
    expect(body).not.toMatch(/<a[^>]*>\s*Regenerate/);
    expect(body).not.toMatch(/<a[^>]*>\s*Reissue/);
  });

  it('no planted marker leaks into any refusal body across the whole matrix', async () => {
    const f = await buildFixture();
    const { docId: poDocId } = await f.mintArchived('purchase-order');
    const { docId: payslipDocId } = await f.mintArchived('payslip', 'E1');
    const draftDocId = f.mintDraft('purchase-order');
    f.registryStore.markPurged(poDocId, '2026-01-01T00:00:00Z');

    const refusals = await Promise.all([
      f.reproduce('nope', { reason: 'x', subject: 's' }),
      f.reproduce(poDocId, { subject: 's' }), // reason missing (already purged, but reason check comes from admitReprint before purge is read)
      f.reproduce(poDocId, {}), // actor missing
      f.reproduce(payslipDocId, { reason: 'x', subject: 'E2', role: 'employee' }),
      f.reproduce(draftDocId, { reason: 'x', subject: 's' }),
    ]);
    for (const r of refusals) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.bodyText).not.toContain(PLANTED_MARKER);
    }
  });
});
