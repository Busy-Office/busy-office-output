/**
 * GAP-08 closing proof: a document type the engine has never heard of
 * registers from OUTSIDE the engine tree and round-trips every data verb
 * — registerDocumentType → emit → preview → status — through the real
 * pipeline (`createRuntimeDeps`: SQLite registry, FS archive, real
 * TypstRenderer). The built-ins are registered too, showing a host adds
 * its own type NEXT TO them, not instead of them.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { createRuntimeDeps } from '@busy-office/runtime';
import { sampleMemo, validSampleMemo } from './definition.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('sample-memo: a document type registered from outside the engine tree', () => {
  it('registers, emits, previews, and reports status through OutputPort v1', async () => {
    const root = tempDir('sample-memo-');
    const deps = createRuntimeDeps(join(root, 'registry.db'), join(root, 'archive'), join(root, 'outbox'));
    const port = deps.output;
    try {
      // Before registration the engine genuinely does not know this type.
      const before = await port.emit({
        documentType: 'sample-memo',
        payload: validSampleMemo(),
        businessEvent: { businessObject: 'MEMO', businessObjectId: 'MEMO-0001', event: 'memo.sent', templateVersion: '1.0.0' },
        determination: { recipients: ['someone@example.com'] },
      });
      expect(before.status).toBe('unknown-document-type');

      // Verb 5, from a definition that lives under test/, not packages/.
      const registration = port.registerDocumentType(sampleMemo);
      expect(registration).toEqual({
        status: 'registered',
        documentType: 'sample-memo',
        templateIds: ['sample-memo-global-v1'],
        messageTemplateIds: ['sample-memo-email-global-v1'],
      });
      // The built-ins are still there — the host's type sits beside them.
      expect(deps.documentTypes.documentTypes()).toEqual(['invoice', 'payslip', 'purchase-order', 'sample-memo']);

      // emit: validated against the memo contract, routed by the memo rule.
      const businessEvent = { businessObject: 'MEMO', businessObjectId: 'MEMO-0001', event: 'memo.sent', templateVersion: '1.0.0' };
      const emitted = await port.emit({
        documentType: 'sample-memo',
        payload: validSampleMemo(),
        businessEvent,
        determination: { recipients: ['someone@example.com'] },
      });
      expect(emitted.status).toBe('accepted');
      if (emitted.status !== 'accepted') throw new Error('unreachable');
      expect(emitted.resolutions).toHaveLength(1);
      expect(emitted.resolutions[0]).toMatchObject({
        ruleId: 'sample-memo-default-email',
        templateId: 'sample-memo-global-v1',
        channel: 'email',
        recipients: ['someone@example.com'],
        composition: { outcome: 'rendered' },
      });
      // The memo contract is enforced (an invalid memo is rejected by ITS schema).
      const invalid = await port.emit({
        documentType: 'sample-memo',
        payload: { ...validSampleMemo(), header: {} },
        businessEvent: { ...businessEvent, businessObjectId: 'MEMO-BAD' },
      });
      expect(invalid.status).toBe('invalid-contract');

      // preview: bytes back, no new registry row.
      const rowsBeforePreview = deps.registryStore.listDocuments().length;
      const preview = await port.preview({ documentType: 'sample-memo', payload: validSampleMemo(), templateId: 'sample-memo-global-v1' });
      expect(preview.status).toBe('rendered');
      if (preview.status !== 'rendered') throw new Error('unreachable');
      expect(preview.mediaType).toBe('application/pdf');
      expect(countPdfPages(preview.bytes)).toBe(1);
      expect(preview.renderer).toMatch(/^typst@/);
      expect(deps.registryStore.listDocuments().length).toBe(rowsBeforePreview);

      // status: the same docId emit minted, archived, with its trace.
      const status = await port.status(businessEvent);
      expect(status).toHaveLength(1);
      expect(status[0]).toMatchObject({
        docId: emitted.resolutions[0].docId,
        ruleId: 'sample-memo-default-email',
        documentType: 'sample-memo',
        state: 'ORIGINAL',
        archived: true,
      });
      expect(status[0].trace?.outcome).toBe('matched');
      expect('ownerId' in status[0]).toBe(false);
    } finally {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }
  }, 60_000);
});
