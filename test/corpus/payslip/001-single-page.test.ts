import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePayslip } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 001-single-page', () => {
  const data = generatePayslip(CORPUS_CASES['001-single-page']);

  it('is a single-currency payslip', () => {
    const currencies = new Set([
      data.header.currency,
      ...data.lines.map((l) => l.amount.currency),
      data.totals.grossPay.currency,
      data.totals.totalDeductions.currency,
      data.totals.netPay.currency,
    ]);
    expect(currencies.size).toBe(1);
  });

  it('totals reconcile: grossPay - totalDeductions === netPay', () => {
    expect(data.totals.grossPay.amount - data.totals.totalDeductions.amount).toBe(data.totals.netPay.amount);
  });

  it('renders deterministically (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data);
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);
});
