import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 002-two-page', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['002-two-page']);

  it('renders deterministically (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data);
    expect(countPdfPages(bytes)).toBe(2);
  }, 30000);
});
