import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';
import { renderPurchaseOrder } from './render.js';

describe('corpus 005-totals-at-boundary', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['005-totals-at-boundary']);

  it('pushes the totals block to a fresh page instead of splitting or overflowing it', async () => {
    const bytes = await assertDeterministic(data);
    // Empirically tuned (see generate.ts comment + session report sweep):
    // one line fewer (26) fits everything, including totals, on page 1.
    // At 27 lines the totals block no longer fits on page 1 and Typst's
    // `breakable: false` correctly carries it forward whole onto page 2 —
    // not split, and (per the renderer's overflow guard actually running
    // without throwing here) not silently clipped either.
    expect(countPdfPages(bytes)).toBe(2);
  }, 30000);

  it('sanity: one line fewer fits everything on a single page (proves 27 really is the boundary)', async () => {
    const oneLess = generatePurchaseOrder({ ...CORPUS_CASES['005-totals-at-boundary'], lineCount: 26 });
    const artifact = await renderPurchaseOrder(oneLess);
    expect(countPdfPages(artifact.bytes)).toBe(1);
  }, 30000);
});
