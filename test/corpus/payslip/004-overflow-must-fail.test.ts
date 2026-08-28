import { describe, expect, it } from 'vitest';
import { TypstOverflowError } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePayslip } from './generate.js';
import { renderPayslip } from './render.js';

describe('corpus 004-overflow-must-fail', () => {
  it('FAILS the render — Gate 4: overflow must fail loudly, never silently clip', async () => {
    const data = generatePayslip(CORPUS_CASES['004-overflow-must-fail']);
    // 6000 lines, well over DEFAULT_MAX_PAGES (60, renderer.ts) — same
    // overflow-guard proof as test/corpus/invoice/004-overflow-must-fail.test.ts
    // and test/corpus/purchase-order/006-overflow-must-fail.test.ts. A
    // "compact" template never needs this many components in practice
    // (see generate.ts's CORPUS_CASES comment) — this proves the safety
    // net still fires if it were ever handed one anyway.
    await expect(renderPayslip(data)).rejects.toThrow(TypstOverflowError);
    await expect(renderPayslip(data)).rejects.toThrow(/max-page guard/);
  }, 120000);
});
