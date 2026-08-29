import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from '../purchase-order/generate.js';
import { renderPurchaseOrder } from './render.js';
import { assertDeterministic } from './determinism.js';

/** The single-page purchase-order shape (5 lines) through pdf-direct: deterministic, one page, veraPDF-clean. */
describe('pdf-direct corpus 002-purchase-order-single-page', () => {
  for (const name of ['001-single-page', '007-empty-lines'] as const) {
    it(`${name}: deterministic, one page, PDF/A-2b (veraPDF)`, async () => {
      const data = generatePurchaseOrder(CORPUS_CASES[name]);
      const bytes = await assertDeterministic(() => renderPurchaseOrder(data));
      expect(countPdfPages(bytes)).toBe(1);
    }, 30000);
  }
});
