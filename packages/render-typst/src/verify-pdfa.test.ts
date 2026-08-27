import { describe, expect, it } from 'vitest';
import { TypstRenderer } from './renderer.js';
import { verifyPdfA, VeraPdfError } from './verify-pdfa.js';
import type { DocNode, LayoutIR, PurchaseOrderData } from '@busy-office/output-schema';

const MINIMAL_DATA: PurchaseOrderData = {
  schemaVersion: '1.0.0',
  documentType: 'purchase-order',
  header: {
    poNumber: 'PO-1',
    poDate: '2026-08-27',
    currency: 'USD',
    buyer: { name: 'Buyer Co', address: { line1: '1 Main St', city: 'Springfield', country: 'US' } },
    vendor: { name: 'Vendor Co', address: { line1: '2 Side St', city: 'Rivertown', country: 'US' } },
  },
  lines: [
    {
      lineNumber: 1,
      materialId: 'MAT-1',
      description: 'Widget',
      quantity: 1,
      unitOfMeasure: 'EA',
      unitPrice: { currency: 'USD', amount: 100 },
      netAmount: { currency: 'USD', amount: 100 },
    },
  ],
  totals: {
    netTotal: { currency: 'USD', amount: 100 },
    taxTotal: { currency: 'USD', amount: 8 },
    grandTotal: { currency: 'USD', amount: 108 },
  },
};

const MINIMAL_TEMPLATE: DocNode = {
  kind: 'document',
  page: { size: 'A4', margin: [40, 40, 40, 40] },
  children: [{ kind: 'text', value: 'header.poNumber' }],
};

/**
 * ADR-006 / docs/STANDARDS.md Tier 2: verify the veraPDF helper itself,
 * independent of the corpus suite's use of it — a real compliant render
 * must report `compliant: true` with zero failures, and a real
 * non-compliant PDF (plain `typst compile`, no `--pdf-standard`) must
 * report the validator's actual findings, never a silent pass.
 */
describe('verifyPdfA', () => {
  it('reports compliant: true with the validator’s real findings for a PDF/A-2b render', async () => {
    const renderer = new TypstRenderer();
    const ir: LayoutIR = { irVersion: '1.0.0', root: MINIMAL_TEMPLATE, data: MINIMAL_DATA };
    const artifact = await renderer.render({ kind: 'ir', ir });

    const result = await verifyPdfA(artifact.bytes, '2b');

    expect(result.compliant).toBe(true);
    expect(result.failedRules).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.passedRules).toBeGreaterThan(0);
  }, 30000);

  it('reports compliant: false with real rule findings for a non-PDF/A file', async () => {
    // Deliberately NOT PDF/A-2b: no --pdf-standard, so no XMP identification
    // schema — proves the check actually catches a real violation rather
    // than always reporting success.
    const { spawn } = await import('node:child_process');
    const { mkdtemp, writeFile, rm, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'bo-verapdf-test-'));
    try {
      const srcPath = join(dir, 'doc.typ');
      const pdfPath = join(dir, 'doc.pdf');
      await writeFile(srcPath, '#set page(width: 200pt, height: 200pt)\nHello', 'utf8');
      await new Promise<void>((resolve, reject) => {
        const child = spawn('typst', ['compile', srcPath, pdfPath]);
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`typst exited ${code}`))));
      });
      const bytes = await readFile(pdfPath);

      const result = await verifyPdfA(bytes, '2b');

      expect(result.compliant).toBe(false);
      expect(result.failedRules).toBeGreaterThan(0);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures[0]?.description ?? result.failures[0]?.errorMessage).toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('throws VeraPdfError rather than silently passing when the binary cannot be run', async () => {
    const renderer = new TypstRenderer();
    const ir: LayoutIR = { irVersion: '1.0.0', root: MINIMAL_TEMPLATE, data: MINIMAL_DATA };
    const artifact = await renderer.render({ kind: 'ir', ir });

    await expect(verifyPdfA(artifact.bytes, '2b', { verapdfBin: 'not-a-real-verapdf-binary' })).rejects.toThrow(
      VeraPdfError,
    );
  }, 30000);
});
