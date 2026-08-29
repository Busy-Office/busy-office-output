import { describe, expect, it } from 'vitest';
import { PdfDirectUnsupportedError } from '@busy-office/render-pdf-direct';
import { CORPUS_CASES, generatePayslip } from '../payslip/generate.js';
import { renderPayslip } from './render.js';

/**
 * The third clause of the routing rule: Latin-only. docs/RESULTS.md's
 * Stage 0 RTL/CJK smoke test showed pdf-lib failing ja-JP subsetting and
 * ar-SA shaping; ADR-001 routes those documents to Typst. pdf-direct
 * therefore refuses non-Latin text up front (packages/render-pdf-direct/
 * src/latin.ts) instead of painting .notdef boxes — a legible-looking PDF
 * with unreadable names would be a silent failure, the opposite of Gate 4.
 * Latin-1/Latin Extended (accents) IS Latin and renders.
 */
describe('pdf-direct corpus 005-rejects-non-latin', () => {
  const base = generatePayslip(CORPUS_CASES['001-single-page']);

  it.each([
    ['ja-JP', '田中 太郎'],
    ['th-TH', 'สมชาย ใจดี'],
    ['ar-SA', 'محمد أحمد'],
  ])('%s employee name is refused with PdfDirectUnsupportedError', async (_locale, name) => {
    const data = { ...base, header: { ...base.header, employeeName: name } };
    await expect(renderPayslip(data)).rejects.toBeInstanceOf(PdfDirectUnsupportedError);
    await expect(renderPayslip(data)).rejects.toThrow(/non-Latin .* typst/);
  });

  it('Latin Extended (accented) names render', async () => {
    const data = { ...base, header: { ...base.header, employeeName: 'Zoë Ångström-Łukasiewicz' } };
    const artifact = await renderPayslip(data);
    expect(artifact.mediaType).toBe('application/pdf');
    expect(artifact.bytes.length).toBeGreaterThan(0);
  });
});
