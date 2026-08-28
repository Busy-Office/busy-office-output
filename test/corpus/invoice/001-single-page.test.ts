import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generateInvoice } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 001-single-page', () => {
  const data = generateInvoice(CORPUS_CASES['001-single-page']);

  it('is a single-currency invoice (multi-currency scope decision (b) — see generate.ts)', () => {
    const currencies = new Set([
      data.header.currency,
      ...data.lines.map((l) => l.unitPrice.currency),
      ...data.lines.map((l) => l.netAmount.currency),
      data.totals.netTotal.currency,
      data.totals.taxTotal.currency,
      data.totals.grandTotal.currency,
    ]);
    expect(currencies.size).toBe(1);
  });

  it('renders deterministically (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data);
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);
});
