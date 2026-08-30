/**
 * PDF page-merge utility ("PDF attachment concatenation").
 *
 * Scope note: this is PAGE-LEVEL concatenation (cover sheet + rendered
 * document + T&C, combined into one PDF whose pages are the union of its
 * sources', in order), NOT ISO 19005-3
 * embedded-file attachment (PDF/A-3, Factur-X's "one PDF containing a
 * separate embedded XML/PDF file" — docs/STANDARDS.md Tier 3, deferred).
 * Do not extend this file toward embedded-file attachments; that is a
 * different mechanism gated on a different trigger.
 *
 * Uses `pdf-lib` (this package's one new dependency — packages/schema stays
 * zero-runtime-dependency, untouched). `pdf-lib` has no built-in PDF/A
 * awareness (docs/STANDARDS.md's renderer-reality table already says so for
 * the pdf-direct spike) and `PDFDocument.create()` starts from a bare
 * catalog with neither an `/OutputIntents` array nor an XMP `/Metadata`
 * stream. Copying pages alone would therefore produce a merged PDF that
 * fails PDF/A-2b validation even though every source page came from a
 * conformant `typst compile --pdf-standard a-2b` render: per-page content
 * (fonts, resources) travels with `copyPages`, but catalog-level PDF/A
 * conformance signals do not. This function explicitly re-attaches those
 * two catalog entries, copied from the first source PDF that has them,
 * via `PDFObjectCopier` (so the ICC-profile stream and XMP stream are
 * copied as real indirect objects, not just referenced across documents).
 * Verified empirically against `verapdf -f 2b`, not assumed — see
 * merge-pdf.test.ts.
 */
import { PDFDocument, PDFName, PDFObjectCopier } from 'pdf-lib';

/**
 * Concatenate multiple PDFs' pages, in order, into one combined PDF.
 * Each source's pages are preserved exactly (content, fonts, resources);
 * only page ORDER across documents is new. Re-attaches PDF/A-2b
 * `/OutputIntents` + `/Metadata` from the first source that has them, so a
 * merge of already-compliant sources stays PDF/A-2b compliant.
 */
export async function mergePdfs(pdfBuffers: Uint8Array[]): Promise<Uint8Array> {
  if (pdfBuffers.length === 0) {
    throw new Error('mergePdfs requires at least one PDF buffer.');
  }

  const merged = await PDFDocument.create();
  const sources = await Promise.all(pdfBuffers.map((bytes) => PDFDocument.load(bytes)));

  for (const src of sources) {
    const copiedPages = await merged.copyPages(src, src.getPageIndices());
    for (const page of copiedPages) {
      merged.addPage(page);
    }
  }

  const outputIntentsName = PDFName.of('OutputIntents');
  const metadataName = PDFName.of('Metadata');

  const pdfaSource = sources.find((src) => src.catalog.get(outputIntentsName) !== undefined);
  if (pdfaSource !== undefined) {
    const copier = PDFObjectCopier.for(pdfaSource.context, merged.context);

    const outputIntents = pdfaSource.catalog.get(outputIntentsName);
    if (outputIntents !== undefined) {
      merged.catalog.set(outputIntentsName, copier.copy(outputIntents));
    }

    const metadata = pdfaSource.catalog.get(metadataName);
    if (metadata !== undefined) {
      merged.catalog.set(metadataName, copier.copy(metadata));
    }
  }

  // PDF/A (and plain ISO 32000) requires a trailer /ID — `PDFDocument.create()`
  // does not set one on its own. Reuse the first source's ID array if it has
  // one (any well-formed pair passes veraPDF 6.1.3-1; CLAUDE.md's determinism
  // normalization zeroes it out before any byte comparison regardless, same
  // as it already does for every other renderer's output — see
  // normalize-pdf.ts).
  const idSource = sources.find((src) => src.context.trailerInfo.ID !== undefined);
  if (idSource?.context.trailerInfo.ID !== undefined) {
    const copier = PDFObjectCopier.for(idSource.context, merged.context);
    merged.context.trailerInfo.ID = copier.copy(idSource.context.trailerInfo.ID);
  }

  // useObjectStreams: false — this codebase's countPdfPages/normalizePdf
  // (pdf-page-count.ts, normalize-pdf.ts) are deliberate plain byte-text
  // scans over the PDF, not a parsing library, matching what `typst
  // compile` already emits uncompressed at the xref/object level. Leaving
  // pdf-lib's default object-stream compression on would make every
  // `/Type /Page` (and the trailer fields normalize-pdf.ts zeroes) invisible
  // to that byte scan without changing anything about the merge itself.
  const bytes = await merged.save({ useObjectStreams: false });
  return new Uint8Array(bytes);
}
