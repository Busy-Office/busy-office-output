import { describe, expect, it } from 'vitest';
import { countPdfPages, formatIsoDateLocale, formatMoneyCentsLocale } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';
import { renderPurchaseOrder } from './render.js';
import { flattenedText, flattenedWords, indexOfWord } from './locale-helpers.js';

/**
 * ROADMAP Stage 6 task 1: "Locale packs ... corpus locale cases green."
 * Same `purchaseOrderTemplate` as every other corpus case (test/corpus/
 * purchase-order/template.ts) — only `opts.locale` differs, proving "zero
 * forking" for en-SG specifically. en-SG is the Western-order baseline:
 * DD/MM/YYYY dates, Latin-digit grouped decimals, street-then-city-postal
 * address order (packages/render-typst/src/format.ts's `ADDRESS_RULES`).
 */
describe('corpus 010-locale-en-sg', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);
  const locale = 'en-SG';

  it('renders deterministically for en-SG (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data, { locale });
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);

  it('prints the PO date and grand total in en-SG format, and Western address line order', async () => {
    const artifact = await renderPurchaseOrder(data, { locale });
    const bytes = artifact.bytes;
    const text = await flattenedText(bytes);

    const expectedDate = formatIsoDateLocale(data.header.poDate, locale);
    expect(expectedDate).toBe('27/08/2026'); // DD/MM/YYYY, Latin digits — verified empirically, not assumed
    expect(text).toContain(expectedDate);

    const expectedGrandTotal = formatMoneyCentsLocale(data.totals.grandTotal.amount, locale);
    expect(text).toContain(expectedGrandTotal);

    const words = await flattenedWords(bytes);
    const line1FirstToken = data.header.buyer.address.line1.split(' ')[0]!;
    const streetIdx = indexOfWord(words, line1FirstToken);
    const postalIdx = indexOfWord(words, data.header.buyer.address.postalCode!);
    expect(streetIdx).toBeLessThan(postalIdx); // Western order: street line(s) before city+postal
  }, 30000);
});
