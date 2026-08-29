import { describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { verifyPdfA } from '@busy-office/render-typst';
import { loadAssets } from './assets.js';
import { applyPdfA2b, buildXmpPacket } from './pdfa.js';

const identity = {
  title: 'test',
  creatorTool: 'busy-office-output',
  producer: 'test producer',
  now: new Date('2026-08-29T03:35:02Z'),
  documentIdHex: '2aaf2e31fa014be4400dd31d37decbb3',
};

/**
 * The check must have teeth for THIS renderer, not only for Typst (where
 * the corpus already proved an unflagged `typst compile` fails veraPDF).
 * Three documents, one variable each: no catalog entries at all; the
 * Stage 0 spike's non-embedded Helvetica with the catalog entries; and
 * the real thing. Only the last may pass.
 */
describe('applyPdfA2b (veraPDF, PDF/A-2b)', () => {
  it('a bare pdf-lib document with an embedded TTF but no PDF/A catalog entries FAILS veraPDF', async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(loadAssets().regularTtf, { subset: true });
    pdf.addPage([200, 200]).drawText('hello', { x: 10, y: 100, size: 12, font });
    const result = await verifyPdfA(new Uint8Array(await pdf.save({ useObjectStreams: false })), '2b');
    expect(result.compliant).toBe(false);
    const ids = result.failures.map((f) => f.ruleId);
    // 6.6.2.1/6.6.4: no XMP, no PDF/A identification; 6.2.3: no OutputIntent for DeviceRGB.
    expect(ids.some((id) => id?.startsWith('6.6.'))).toBe(true);
  });

  it("the Stage 0 spike's StandardFonts.Helvetica (not embedded) FAILS veraPDF even with the catalog entries", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([200, 200]).drawText('hello', { x: 10, y: 100, size: 12, font });
    applyPdfA2b(pdf, loadAssets().sRgbIcc, identity);
    const result = await verifyPdfA(new Uint8Array(await pdf.save({ useObjectStreams: false })), '2b');
    expect(result.compliant).toBe(false);
    expect(result.failures.map((f) => f.ruleId)).toEqual(expect.arrayContaining([expect.stringMatching(/^6\.2\.11\.4/)]));
  });

  it('embedded TTF + XMP + OutputIntent + trailer ID PASSES veraPDF 2b', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(loadAssets().regularTtf, { subset: true });
    pdf.addPage([200, 200]).drawText('hello', { x: 10, y: 100, size: 12, font });
    applyPdfA2b(pdf, loadAssets().sRgbIcc, identity);
    const result = await verifyPdfA(new Uint8Array(await pdf.save({ useObjectStreams: false })), '2b');
    expect(result.failures).toEqual([]);
    expect(result.compliant).toBe(true);
  });
});

describe('buildXmpPacket', () => {
  it('carries the PDF/A identification schema and mirrors every Info-dict entry in element form', () => {
    const xmp = buildXmpPacket(identity);
    expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<xmp:CreateDate>2026-08-29T03:35:02Z</xmp:CreateDate>');
    expect(xmp).toContain('<xmp:ModifyDate>2026-08-29T03:35:02Z</xmp:ModifyDate>');
    expect(xmp).toContain('<xmp:CreatorTool>busy-office-output</xmp:CreatorTool>');
    expect(xmp).toContain('<pdf:Producer>test producer</pdf:Producer>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">test</rdf:li>');
  });

  it('XML-escapes values', () => {
    expect(buildXmpPacket({ ...identity, title: 'a<b>&"c"' })).toContain('a&lt;b&gt;&amp;&quot;c&quot;');
  });
});
