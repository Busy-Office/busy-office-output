import { describe, expect, it } from 'vitest';
import { TypstOverflowError } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { renderPurchaseOrder } from './render.js';

describe('corpus 006-overflow-must-fail', () => {
  it('FAILS the render — Gate 4: overflow must fail loudly, never silently clip', async () => {
    const data = generatePurchaseOrder(CORPUS_CASES['006-overflow-must-fail']);
    // 2100 lines -> ~68 pages, comfortably over DEFAULT_MAX_PAGES (60,
    // renderer.ts). This exercises Guard 1 (the fixed page-count cap). The
    // renderer's other guard (Guard 2 — the totals-block position marker,
    // emit-typst.ts) catches the sharper "silently clipped content" bug
    // class but isn't reachable through data alone on this fixed template
    // (totals is always exactly 3 short rows) — see the session report for
    // the empirical proof that Typst clips an oversized unbreakable block
    // silently (exit 0, no diagnostics) and why a page cap alone would NOT
    // have caught that shape.
    await expect(renderPurchaseOrder(data)).rejects.toThrow(TypstOverflowError);
    await expect(renderPurchaseOrder(data)).rejects.toThrow(/max-page guard/);
  }, 120000);
});
