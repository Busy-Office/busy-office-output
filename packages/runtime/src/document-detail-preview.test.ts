/**
 * Document detail's passive inline preview — `GET
 * /output/documents/:docId/preview`. Unlike `reproduce` (GAP-26), this
 * route is a browser `<embed>` load, not an explicit reprint action: it
 * must authorize against the document exactly as `reproduce` does, but
 * never stamp a `reprint_log` row and never require a reason.
 *
 * Real HTTP against `createIngressServer` (server.ts), a real
 * `FsArchiveStore`, and the built-in document types
 * (`registerBuiltinDocumentTypes`) — no rendering (bytes are minted
 * directly via `archiveArtifact`, the same shortcut
 * `document-detail-reproduce.test.ts` uses).
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

const PLANTED_MARKER = 'PLANTED-PAYSLIP-RECIPIENT-9d3e7b';

describe('GET /output/documents/:docId/preview', () => {
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
    const archiveStore = new FsArchiveStore(tempDir('preview-archive-'));
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
        inputHash: 'test-input-hash',
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

    async function preview(docId: string, opts: { subject?: string; role?: string } = {}) {
      const headers: Record<string, string> = {};
      if (opts.subject !== undefined) headers['X-Actor-Subject'] = opts.subject;
      if (opts.role !== undefined) headers['X-Actor-Role'] = opts.role;
      const res = await fetch(`${baseUrl}/output/documents/${encodeURIComponent(docId)}/preview`, { headers, redirect: 'manual' });
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

    return { registryStore, archiveStore, mintArchived, mintDraft, preview, detail };
  }

  it('archived document: 200, inline disposition, byte-identical body, ZERO new reprint_log rows', async () => {
    const f = await buildFixture();
    const { docId, bytes } = await f.mintArchived('purchase-order');

    const before = f.registryStore.listReprintLog(docId);
    expect(before).toEqual([]);
    const res = await f.preview(docId, { subject: 'ops-1', role: 'console' });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/pdf');
    expect(res.contentDisposition).toBe('inline');
    expect(res.bytes).toEqual(bytes);

    // The entire point of this route: no audit stamp for a passive view.
    const after = f.registryStore.listReprintLog(docId);
    expect(after).toHaveLength(before.length);
    expect(after).toEqual([]);
  });

  it('archived document with NO actor identity asserted: still 200 (console default actor), zero reprint_log rows', async () => {
    const f = await buildFixture();
    const { docId, bytes } = await f.mintArchived('purchase-order');

    const res = await f.preview(docId); // no headers at all
    expect(res.status).toBe(200);
    expect(res.bytes).toEqual(bytes);
    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
  });

  it('not-yet-archived (DRAFT) document: plain-text placeholder response, not a crash', async () => {
    const f = await buildFixture();
    const docId = f.mintDraft('purchase-order');

    const res = await f.preview(docId, { subject: 'ops-1' });
    expect(res.status).toBe(409);
    expect(res.contentType).toContain('text/plain');
    expect(res.bodyText).toContain('has not been archived');
    expect(res.contentDisposition).toBeNull();
    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
  });

  it('purged document: plain-text placeholder response, no bytes, zero reprint_log rows', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('purchase-order');
    f.registryStore.markPurged(docId, '2026-01-01T00:00:00Z');

    const res = await f.preview(docId, { subject: 'ops-1' });
    expect(res.status).toBe(410);
    expect(res.contentType).toContain('text/plain');
    expect(res.bodyText).toContain('2026-01-01T00:00:00Z');
    expect(res.bodyText).not.toContain(PLANTED_MARKER);
    expect(res.contentDisposition).toBeNull();
    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
  });

  it('wrong-owner actor on an owner-scoped (payslip) document: 403 plain text, archive never read, zero reprint_log rows', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('payslip', 'E1');
    const retrieveSpy = vi.spyOn(f.archiveStore, 'retrieve');

    const res = await f.preview(docId, { subject: 'E2', role: 'employee' });
    expect(res.status).toBe(403);
    expect(res.contentType).toContain('text/plain');
    expect(res.bodyText).not.toContain(PLANTED_MARKER);
    expect(retrieveSpy).not.toHaveBeenCalled();
    expect(f.registryStore.listReprintLog(docId)).toEqual([]);
  });

  it('unknown docId: 404 plain text', async () => {
    const f = await buildFixture();
    const res = await f.preview('does-not-exist', { subject: 'ops-1' });
    expect(res.status).toBe(404);
    expect(res.contentType).toContain('text/plain');
    expect(res.bodyText).not.toContain(PLANTED_MARKER);
  });

  it('Document detail: archived doc gets an A4 frame with an <embed> at the preview route', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('purchase-order');
    const { status, body } = await f.detail(docId);
    expect(status).toBe(200);

    expect(body).toContain('class="a4-frame"');
    expect(body).toContain(`<embed type="application/pdf" src="/output/documents/${docId}/preview"`);
    expect(body).not.toMatch(/<script/i);
  });

  it('Document detail: DRAFT doc gets the A4 frame but NO <embed> (a placeholder instead)', async () => {
    const f = await buildFixture();
    const docId = f.mintDraft('purchase-order');
    const { status, body } = await f.detail(docId);
    expect(status).toBe(200);

    expect(body).toContain('class="a4-frame"');
    expect(body).not.toContain('<embed');
    expect(body).toContain('not archived yet');
    expect(body).not.toMatch(/<script/i);
  });

  it('Document detail: purged doc gets the A4 frame but NO <embed> (a placeholder instead)', async () => {
    const f = await buildFixture();
    const { docId } = await f.mintArchived('purchase-order');
    f.registryStore.markPurged(docId, '2026-01-01T00:00:00Z');
    const { status, body } = await f.detail(docId);
    expect(status).toBe(200);

    expect(body).toContain('class="a4-frame"');
    expect(body).not.toContain('<embed');
    expect(body).toContain('purged');
    expect(body).not.toMatch(/<script/i);
  });

  it('no planted marker leaks into any refusal body across the whole matrix', async () => {
    const f = await buildFixture();
    const { docId: payslipDocId } = await f.mintArchived('payslip', 'E1');
    const draftDocId = f.mintDraft('purchase-order');
    const { docId: poDocId } = await f.mintArchived('purchase-order');
    f.registryStore.markPurged(poDocId, '2026-01-01T00:00:00Z');

    const refusals = await Promise.all([
      f.preview('nope', { subject: 's' }),
      f.preview(payslipDocId, { subject: 'E2', role: 'employee' }),
      f.preview(draftDocId, { subject: 's' }),
      f.preview(poDocId, { subject: 's' }),
    ]);
    for (const r of refusals) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.bodyText).not.toContain(PLANTED_MARKER);
    }
  });
});
