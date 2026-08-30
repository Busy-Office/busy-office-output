import { describe, expect, it } from 'vitest';
import type { LayoutIR } from '@busy-office/output-schema';
import { UnformattableValueError } from '@busy-office/render-typst';
import { renderer } from './render.js';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { purchaseOrderTemplate } from './template.js';

describe('corpus 015-malformed-totals-expression', () => {
  it('FAILS the render — GAP-28: a totals row expression missing ".amount" (pointing at the Money object itself, not its amount field) must fail loudly, never silently print "[object Object]"', async () => {
    const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);

    // Same tree as the real template, except the "Grand total" row's
    // expression is the template-authoring typo this test guards against:
    // `totals.grandTotal` (the Money object) instead of the correct
    // `totals.grandTotal.amount`.
    const root = structuredClone(purchaseOrderTemplate);
    const totalsNode = root.children.find((c) => c.kind === 'totals');
    if (!totalsNode || totalsNode.kind !== 'totals') {
      throw new Error('test setup: purchaseOrderTemplate has no totals node');
    }
    const grandTotalRow = totalsNode.rows.find((r) => r.label === 'Grand total');
    if (!grandTotalRow) {
      throw new Error('test setup: totals node has no "Grand total" row');
    }
    grandTotalRow.value = 'totals.grandTotal';

    const ir: LayoutIR = { irVersion: '1.0.0', root, data };

    await expect(renderer.render({ kind: 'ir', ir })).rejects.toThrow(UnformattableValueError);
    await expect(renderer.render({ kind: 'ir', ir })).rejects.toThrow(/totals\.grandTotal\.amount/);
  });
});
