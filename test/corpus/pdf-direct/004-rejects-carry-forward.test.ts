import { describe, expect, it } from 'vitest';
import { PdfDirectUnsupportedError } from '@busy-office/render-pdf-direct';
import { CORPUS_CASES, generatePayslip } from '../payslip/generate.js';
import { payslipTemplate } from '../payslip/template.js';
import { renderPayslip } from './render.js';

/**
 * Routing-rule enforcement (ADR-001 → ADR-002 task): a template whose
 * table declares `carryForward` is Typst's, full stop. Even when the data
 * would fit on one page (this is the 001-single-page payslip), pdf-direct
 * refuses the Typst payslip template rather than rendering it without the
 * carried-forward semantics the template asked for. A template that
 * wants pdf-direct declares no carryForward (templates.ts).
 */
describe('pdf-direct corpus 004-rejects-carry-forward', () => {
  it('refuses the typst payslip template (carryForward: amount.amount) with PdfDirectUnsupportedError', async () => {
    const data = generatePayslip(CORPUS_CASES['001-single-page']);
    await expect(renderPayslip(data, payslipTemplate)).rejects.toBeInstanceOf(PdfDirectUnsupportedError);
    await expect(renderPayslip(data, payslipTemplate)).rejects.toThrow(/carryForward .* typst/);
  });
});
