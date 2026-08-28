import { describe, expect, it } from 'vitest';
import { TypstOverflowError } from '@busy-office/render-typst';
import { CORPUS_CASES, generateInvoice } from './generate.js';
import { renderInvoice } from './render.js';

describe('corpus 004-overflow-must-fail', () => {
  it('FAILS the render — Gate 4: overflow must fail loudly, never silently clip', async () => {
    const data = generateInvoice(CORPUS_CASES['004-overflow-must-fail']);
    // 2100 lines, well over DEFAULT_MAX_PAGES (60, renderer.ts) — same
    // overflow-guard proof as test/corpus/purchase-order/006-overflow-must-fail.test.ts.
    await expect(renderInvoice(data)).rejects.toThrow(TypstOverflowError);
    await expect(renderInvoice(data)).rejects.toThrow(/max-page guard/);
  }, 120000);
});
