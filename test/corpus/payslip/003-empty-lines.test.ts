import { describe, expect, it } from 'vitest';
import { countPdfPages } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePayslip } from './generate.js';
import { assertDeterministic } from './determinism.js';

describe('corpus 003-empty-lines', () => {
  const data = generatePayslip(CORPUS_CASES['003-empty-lines']);

  it('has zero lines (edge case sanity)', () => {
    expect(data.lines).toEqual([]);
  });

  it('renders without crashing on an empty table body, deterministically', async () => {
    const bytes = await assertDeterministic(data);
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);
});
