import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generateInvoice } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 003-tax-rate-variation', () => {
  const data = generateInvoice(CORPUS_CASES['003-tax-rate-variation']);

  it('exercises multiple distinct per-line tax rates, including a zero-rated line', () => {
    const rates = new Set(data.lines.map((l) => l.taxRate));
    expect(rates.size).toBeGreaterThan(1);
    expect(rates.has(0)).toBe(true);
  });

  it('taxTotal equals the sum of each line net amount times its own taxRate (per-line, not a single header rate)', () => {
    const expectedTaxTotal = data.lines.reduce((sum, l) => sum + Math.round(l.netAmount.amount * l.taxRate), 0);
    expect(data.totals.taxTotal.amount).toBe(expectedTaxTotal);
  });

  it('renders deterministically', async () => {
    const bytes = await assertDeterministic(data);
    expect(countPdfPages(bytes)).toBeGreaterThanOrEqual(1);
  }, 30000);
});
