import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 001-single-page', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);

  it('renders deterministically (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data);
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);
});
