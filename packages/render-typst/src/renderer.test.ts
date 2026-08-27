import { describe, expect, it } from 'vitest';
import type { DocNode, LayoutIR, PurchaseOrderData } from '@busy-office/output-schema';
import { TypstRenderer, TypstOverflowError } from './renderer.js';

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

function templateWithMargin(margin: [number, number, number, number], totalsRowCount = 3): DocNode {
  const rows = Array.from({ length: totalsRowCount }, (_, i) => ({
    label: `Row ${i + 1}`,
    // Any known-root expression is fine here — the point is row COUNT, not distinct values.
    value: 'totals.netTotal.amount',
  }));
  return {
    kind: 'document',
    page: { size: 'A4', margin },
    children: [{ kind: 'totals', keepTogether: true, rows }],
  };
}

describe('TypstRenderer overflow guard 2 — totals block measured-height guard', () => {
  it('succeeds when the totals block plainly fits the page', async () => {
    const renderer = new TypstRenderer();
    const ir: LayoutIR = { irVersion: '1.0.0', root: templateWithMargin([40, 40, 40, 40]), data: MINIMAL_DATA };
    const artifact = await renderer.render({ kind: 'ir', ir });
    expect(artifact.mediaType).toBe('application/pdf');
  }, 30000);

  it('throws TypstOverflowError when the totals block cannot fit inside the printable page area', async () => {
    // A4 with normal 40pt margins is ~761.89pt of printable height. 150
    // totals rows at 9pt text is comfortably taller than that, so the
    // unbreakable block genuinely cannot fit ANY single page. Per
    // emit-typst.ts's header comment, Typst does NOT error on this by
    // itself (confirmed empirically: exit 0, no diagnostics, content
    // silently laid out hundreds of points past the page's bottom edge,
    // invisible in the rendered PDF) — this proves the renderer's own
    // position-marker guard is what turns that silent clip into a real,
    // thrown failure (Gate 4). (A separate, more pathological margin
    // configuration was tried first and instead made Typst overlap/garble
    // the rows to fit a near-zero content area rather than extending past
    // the page — a different silent-corruption shape this guard does NOT
    // claim to catch; that finding is in the session report.)
    const renderer = new TypstRenderer();
    const ir: LayoutIR = {
      irVersion: '1.0.0',
      root: templateWithMargin([40, 40, 40, 40], 150),
      data: MINIMAL_DATA,
    };
    await expect(renderer.render({ kind: 'ir', ir })).rejects.toThrow(TypstOverflowError);
    await expect(renderer.render({ kind: 'ir', ir })).rejects.toThrow(/cannot fit on any page/);
  }, 30000);

  it('rejects a non-"ir" job kind', async () => {
    const renderer = new TypstRenderer();
    await expect(
      renderer.render({ kind: 'office-template', templateRef: 'x', data: MINIMAL_DATA } as never),
    ).rejects.toThrow(/only accepts job kind 'ir'/);
  });
});
