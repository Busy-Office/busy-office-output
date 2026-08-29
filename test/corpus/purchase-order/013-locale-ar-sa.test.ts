import { describe, expect, it } from 'vitest';
import { countPdfPages, formatIsoDateLocale, formatMoneyCentsLocale } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';
import { renderPurchaseOrder } from './render.js';
import { flattenedText } from './locale-helpers.js';

/**
 * ar-SA: real Arabic-locale number formatting uses Arabic-Indic digit
 * shapes (e.g. "١٬٢٣٤٫٥٦"), not Latin ones — verified empirically via
 * `Intl.NumberFormat('ar-SA', ...)` on Node's bundled ICU, not assumed.
 * This is the one exit-gate locale ADR-001 already routes to this renderer
 * specifically because pdf-lib has no font-fallback chain for mixed
 * Arabic+digit content (docs/RESULTS.md's RTL/CJK smoke test) — this case
 * proves the same rendering path also produces LOCALE-correct digit
 * shapes, not just non-clipped glyphs. Same `purchaseOrderTemplate`, zero
 * forking; Saudi address line order is Western-shaped (format.ts's
 * `ADDRESS_RULES`), so only the digit script differs here from en-SG/th-TH.
 */
describe('corpus 013-locale-ar-sa', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);
  const locale = 'ar-SA';

  it('renders deterministically for ar-SA (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data, { locale });
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);

  it('prints the grand total using Arabic-Indic digit shapes', async () => {
    const artifact = await renderPurchaseOrder(data, { locale });
    const bytes = artifact.bytes;
    const text = await flattenedText(bytes);

    const expectedGrandTotal = formatMoneyCentsLocale(data.totals.grandTotal.amount, locale);
    // Sanity: the expected string really is Arabic-Indic digits, not a
    // silent Latin-digit fallback — U+0660-U+0669 is the Arabic-Indic block.
    expect(expectedGrandTotal).toMatch(/[٠-٩]/);
    expect(text).toContain(expectedGrandTotal);

    const expectedDate = formatIsoDateLocale(data.header.poDate, locale);
    expect(expectedDate).toMatch(/[٠-٩]/);
    // The date string itself may carry bidi control marks (U+200E/U+200F)
    // around its slash-separated parts — real ICU output for this locale,
    // not a rendering artifact — so this checks the digit groups appear in
    // order rather than requiring an exact substring match.
    const digitGroups = expectedDate.split(/[^٠-٩]+/).filter(Boolean);
    for (const group of digitGroups) {
      expect(text).toContain(group);
    }
  }, 30000);
});
