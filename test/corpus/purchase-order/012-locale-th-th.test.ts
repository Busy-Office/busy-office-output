import { describe, expect, it } from 'vitest';
import { countPdfPages, formatIsoDateLocale, formatMoneyCentsLocale } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';
import { renderPurchaseOrder } from './render.js';
import { flattenedText, flattenedWords, indexOfWord } from './locale-helpers.js';

/**
 * th-TH: real Thai-locale dates use the Buddhist Era calendar (year =
 * Gregorian + 543) — Node's `Intl.DateTimeFormat('th-TH', ...)` defaults to
 * it, verified empirically, not assumed (this task's session report flags
 * it for double-checking against whatever the actual business convention
 * turns out to be — some Thai business documents intentionally print the
 * Gregorian year instead; this renderer follows the locale's own default).
 * Address line order and money-grouping digits are Western-shaped for
 * th-TH, same as en-SG. Same `purchaseOrderTemplate`, zero forking.
 */
describe('corpus 012-locale-th-th', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);
  const locale = 'th-TH';

  it('renders deterministically for th-TH (byte-identical after normalization)', async () => {
    const bytes = await assertDeterministic(data, { locale });
    expect(countPdfPages(bytes)).toBe(1);
  }, 30000);

  it('prints the PO date in the Thai Buddhist-Era calendar and Western address line order', async () => {
    const artifact = await renderPurchaseOrder(data, { locale });
    const bytes = artifact.bytes;
    const text = await flattenedText(bytes);

    const expectedDate = formatIsoDateLocale(data.header.poDate, locale);
    expect(expectedDate).toBe('27/08/2569'); // 2026 + 543 = 2569 — verified empirically, not assumed
    expect(text).toContain(expectedDate);

    const expectedGrandTotal = formatMoneyCentsLocale(data.totals.grandTotal.amount, locale);
    expect(text).toContain(expectedGrandTotal);

    const words = await flattenedWords(bytes);
    const line1FirstToken = data.header.buyer.address.line1.split(' ')[0]!;
    const streetIdx = indexOfWord(words, line1FirstToken);
    const postalIdx = indexOfWord(words, data.header.buyer.address.postalCode!);
    expect(streetIdx).toBeLessThan(postalIdx); // Western order, same as en-SG
  }, 30000);
});
