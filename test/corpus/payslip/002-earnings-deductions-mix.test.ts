import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePayslip } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 002-earnings-deductions-mix', () => {
  const data = generatePayslip(CORPUS_CASES['002-earnings-deductions-mix']);

  it('has both earning and deduction line types', () => {
    const types = new Set(data.lines.map((l) => l.type));
    expect(types.has('earning')).toBe(true);
    expect(types.has('deduction')).toBe(true);
  });

  it('line numbers are contiguous starting at 1', () => {
    expect(data.lines.map((l) => l.lineNumber)).toEqual(data.lines.map((_, idx) => idx + 1));
  });

  it('totals reconcile: grossPay - totalDeductions === netPay', () => {
    expect(data.totals.grossPay.amount - data.totals.totalDeductions.amount).toBe(data.totals.netPay.amount);
  });

  it('renders deterministically (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data);
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);
});
