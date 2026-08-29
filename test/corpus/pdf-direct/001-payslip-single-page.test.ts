import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePayslip } from '../payslip/generate.js';
import { renderPayslip } from './render.js';
import { assertDeterministic } from './determinism.js';

/**
 * ROADMAP Stage 4 "pdf-direct second renderer" DoD: "corpus green with
 * pdf-direct rendering the simple/single-page cases, veraPDF passes on
 * every pdf-direct artifact". The payslip is THE pdf-direct case — the
 * high-volume single-page burst ADR-002 kept the renderer for — and the
 * tree here is the one `payslip-companyCode-1000-v1` routes to it.
 */
describe('pdf-direct corpus 001-payslip-single-page', () => {
  for (const name of ['001-single-page', '002-earnings-deductions-mix', '003-empty-lines'] as const) {
    it(`${name}: deterministic, one page, PDF/A-2b (veraPDF)`, async () => {
      const data = generatePayslip(CORPUS_CASES[name]);
      const bytes = await assertDeterministic(() => renderPayslip(data));
      expect(countPdfPages(bytes)).toBe(1);
    }, 30000);
  }
});
