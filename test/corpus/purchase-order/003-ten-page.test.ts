import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 003-ten-page', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['003-ten-page']);

  it('renders deterministically (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data);
    // "roughly matches expectation" per ROADMAP — tuned empirically to 10, allow a point of slack.
    expect(countPdfPages(bytes)).toBeGreaterThanOrEqual(9);
    expect(countPdfPages(bytes)).toBeLessThanOrEqual(11);
  }, 60000);
});
