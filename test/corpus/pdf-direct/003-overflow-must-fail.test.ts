import { describe, expect, it } from 'vitest';
import { PdfDirectOverflowError } from '@busy-office/render-pdf-direct';
import { CORPUS_CASES, generatePurchaseOrder } from '../purchase-order/generate.js';
import { renderPurchaseOrder } from './render.js';

/**
 * Gate 4 (spike/README.md's five gates; HLD §9): overflow FAILS the run.
 * pdf-direct renders exactly one page; a document that needs more must be
 * REJECTED, never truncated to page 1 — a silently clipped multi-page
 * purchase order archived as a one-page "success" would be the worst
 * possible outcome of adding this renderer. These are the multi-page
 * shapes the Typst corpus paginates correctly (002-two-page, 004-120-line-
 * carry-forward) — they belong to Typst by ADR-001; here they prove the
 * refusal.
 */
describe('pdf-direct corpus 003-overflow-must-fail', () => {
  for (const name of ['002-two-page', '004-120-line-carry-forward'] as const) {
    it(`${name}: throws PdfDirectOverflowError instead of clipping to one page`, async () => {
      const data = generatePurchaseOrder(CORPUS_CASES[name]);
      await expect(renderPurchaseOrder(data)).rejects.toBeInstanceOf(PdfDirectOverflowError);
    }, 30000);
  }

  it('the error names what did not fit and points at typst', async () => {
    const data = generatePurchaseOrder(CORPUS_CASES['002-two-page']);
    await expect(renderPurchaseOrder(data)).rejects.toThrow(/does not fit on the single page .* typst/);
  });
});
