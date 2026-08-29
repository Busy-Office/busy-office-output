import { describe, expect, it } from 'vitest';
import { countPdfPages, formatIsoDateLocale, formatMoneyCentsLocale } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';
import { renderPurchaseOrder } from './render.js';
import { flattenedText, flattenedWords, indexOfWord } from './locale-helpers.js';

/**
 * ja-JP: YYYY/MM/DD dates (not DD/MM/YYYY — genuinely different shape from
 * en-SG, verified empirically below) and, per real Japanese convention,
 * postal-code-and-city BEFORE the street line — the reverse of en-SG's
 * order (packages/render-typst/src/format.ts's `ADDRESS_RULES`). Same
 * `purchaseOrderTemplate`, zero forking — only `opts.locale` differs.
 */
describe('corpus 011-locale-ja-jp', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);
  const locale = 'ja-JP';

  it('renders deterministically for ja-JP (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data, { locale });
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);

  it('prints the PO date in ja-JP format and reverses address line order (postal+city before street)', async () => {
    const artifact = await renderPurchaseOrder(data, { locale });
    const bytes = artifact.bytes;
    const text = await flattenedText(bytes);

    const expectedDate = formatIsoDateLocale(data.header.poDate, locale);
    expect(expectedDate).toBe('2026/08/27'); // Y/M/D, Latin digits — verified empirically, not assumed
    expect(text).toContain(expectedDate);

    const expectedGrandTotal = formatMoneyCentsLocale(data.totals.grandTotal.amount, locale);
    expect(text).toContain(expectedGrandTotal);

    const words = await flattenedWords(bytes);
    const line1FirstToken = data.header.buyer.address.line1.split(' ')[0]!;
    const streetIdx = indexOfWord(words, line1FirstToken);
    const postalIdx = indexOfWord(words, data.header.buyer.address.postalCode!);
    expect(postalIdx).toBeLessThan(streetIdx); // ja-JP order: postal+city before the street line
  }, 30000);
});
