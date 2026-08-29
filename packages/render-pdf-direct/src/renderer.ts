/**
 * pdf-direct renderer (ADR-002 Accepted 2026-08-29: the in-process second
 * path for simple, single-page, high-volume bursts; Typst remains the
 * volume default). Implements the same `Renderer` interface as
 * `TypstRenderer` and walks the same `LayoutIR`; the split of work is:
 *
 *   layout.ts  — composition (measure, wrap, place) → draw ops, or throws
 *   this file  — pdf-lib document assembly: embedded TTF fonts (fontkit,
 *                subset), painting the ops, PDF/A-2b catalog entries
 *                (pdfa.ts), deterministic save
 *
 * Everything document-type-agnostic is imported from render-typst, not
 * copied: expression evaluation, money formatting (used in layout.ts) and
 * — for the corpus gate — `normalizePdf`, `countPdfPages`, `verifyPdfA`.
 *
 * Routing rule this renderer enforces on itself (bounded by ADR-001):
 * single page, Latin-only text, no `carryForward`. Anything else throws
 * (`PdfDirectOverflowError` / `PdfDirectUnsupportedError`) — a rejected
 * render, never a clipped or mis-glyphed one (Gate 4).
 */
import { createHash } from 'node:crypto';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import type { Artifact, Renderer, RenderJob } from '@busy-office/output-schema';
import { loadAssets } from './assets.js';
import { layoutDocument, type FontMetrics } from './layout.js';
import { applyPdfA2b } from './pdfa.js';

export { PdfDirectOverflowError, PdfDirectUnsupportedError } from './layout.js';

export const PDF_DIRECT_PRODUCER = 'busy-office-output pdf-direct (pdf-lib 1.17.1)';

/** Minimal view of a parsed fontkit face — only what the glyph-coverage guard needs. */
interface ParsedFace {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

interface GlyphCoverage {
  regular: ParsedFace;
  bold: ParsedFace;
}

let coverage: GlyphCoverage | undefined;

function glyphCoverage(): GlyphCoverage {
  if (coverage === undefined) {
    const assets = loadAssets();
    coverage = {
      regular: fontkit.create(Buffer.from(assets.regularTtf)) as unknown as ParsedFace,
      bold: fontkit.create(Buffer.from(assets.boldTtf)) as unknown as ParsedFace,
    };
  }
  return coverage;
}

export class PdfDirectRenderer implements Renderer {
  readonly id = 'pdf-direct';
  readonly version = '1.17.1'; // pinned pdf-lib version this renderer was built/tested against
  readonly accepts: RenderJob['kind'][] = ['ir'];

  async render(job: RenderJob): Promise<Artifact> {
    if (job.kind !== 'ir') {
      throw new Error(`PdfDirectRenderer only accepts job kind 'ir', got '${job.kind}'`);
    }
    const assets = loadAssets();
    const faces = glyphCoverage();

    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const regular = await pdf.embedFont(assets.regularTtf, { subset: true });
    const bold = await pdf.embedFont(assets.boldTtf, { subset: true });

    const metrics: FontMetrics = {
      widthOf: (text, size, isBold) => (isBold ? bold : regular).widthOfTextAtSize(text, size),
      hasGlyph: (cp, isBold) => (isBold ? faces.bold : faces.regular).hasGlyphForCodePoint(cp),
    };

    // Layout is pure and runs to completion (or throws) before any page exists.
    const layout = layoutDocument(job.ir.root, job.ir.data, metrics);

    const page = pdf.addPage([layout.widthPt, layout.heightPt]);
    for (const op of layout.ops) {
      if (op.op === 'text') {
        page.drawText(op.text, { x: op.x, y: op.y, size: op.size, font: fontFor(op.bold, regular, bold), color: rgb(0, 0, 0) });
      } else {
        page.drawLine({
          start: { x: op.x1, y: op.y1 },
          end: { x: op.x2, y: op.y2 },
          thickness: op.thickness,
          color: rgb(op.gray, op.gray, op.gray),
        });
      }
    }

    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    applyPdfA2b(pdf, assets.sRgbIcc, {
      title: documentTitle(job),
      creatorTool: 'busy-office-output',
      producer: PDF_DIRECT_PRODUCER,
      now,
      documentIdHex: createHash('sha256').update(JSON.stringify(job.ir)).digest('hex').slice(0, 32),
    });

    // useObjectStreams: false — same reason as merge-pdf.ts: countPdfPages
    // and normalizePdf are byte scans that need the trailer/Info/page
    // objects visible in plain text, not packed into an object stream.
    const bytes = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
    return { mediaType: 'application/pdf', bytes: new Uint8Array(bytes) };
  }
}

function fontFor(isBold: boolean, regular: PDFFont, bold: PDFFont): PDFFont {
  return isBold ? bold : regular;
}

/** dc:title / Info Title: the documentType only — never a payload value (payslips are PII; CLAUDE.md). */
function documentTitle(job: Extract<RenderJob, { kind: 'ir' }>): string {
  return job.ir.data.documentType;
}
