/**
 * PDF/A-2b catalog-level conformance for a pdf-lib document (ADR-006,
 * docs/STANDARDS.md Tier 2). pdf-lib has no PDF/A support; the three
 * things it does NOT write that ISO 19005-2 requires are attached here at
 * the low-level object API, the same way merge-pdf.ts re-attaches them
 * when concatenating already-conformant pages:
 *
 *  1. XMP metadata stream (`/Metadata` in the catalog) carrying the PDF/A
 *     identification schema `pdfaid:part=2` / `pdfaid:conformance=B`, plus
 *     the analogues of every Info-dictionary entry (6.6.2.3: Info entries
 *     and their XMP counterparts must agree — Title<->dc:title,
 *     Creator<->xmp:CreatorTool, Producer<->pdf:Producer,
 *     CreationDate<->xmp:CreateDate, ModDate<->xmp:ModifyDate). Written
 *     UNCOMPRESSED: PDF/A forbids filtering the metadata stream, and this
 *     repo's determinism normalization (render-typst's normalize-pdf.ts)
 *     zero-fills the timestamp tags by plain byte scan, which only works
 *     on uncompressed XMP.
 *  2. An `/OutputIntents` entry with `/S /GTS_PDFA1` and an embedded sRGB
 *     ICC profile as `/DestOutputProfile` (6.2.2/6.2.3: every device colour
 *     space used — pdf-lib paints text and lines in DeviceRGB/DeviceGray —
 *     must be covered by the output intent).
 *  3. A trailer `/ID` (6.1.3). `PDFDocument.create()` sets none. Derived
 *     deterministically from a caller-supplied seed (the renderer hashes
 *     the IR) rather than random bytes: two renders of the same input are
 *     then identical by construction, not only after normalization. The
 *     normalization still zeroes it, same as for every other renderer.
 *
 * Fonts (the fourth PDF/A requirement, 6.2.11) are the renderer's job —
 * `embedFont(ttf, { subset: true })` via fontkit — and are not touched here.
 */
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

export interface PdfaIdentity {
  title: string;
  creatorTool: string;
  producer: string;
  /** Wall-clock render time, truncated to whole seconds (XMP and the Info dict must agree to the second). */
  now: Date;
  /** 16 bytes as 32 hex chars; used verbatim for both trailer /ID entries. */
  documentIdHex: string;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO 8601 with a trailing `Z` and second resolution — the XMP form veraPDF matches against the `D:YYYYMMDDHHmmSSZ` Info-dict date pdf-lib's `setCreationDate` writes. */
function xmpDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`
  );
}

export function buildXmpPacket(id: PdfaIdentity): string {
  const created = xmpDate(id.now);
  // Every tag below that carries per-render state (dates) is written in
  // ELEMENT form (<xmp:CreateDate>…</xmp:CreateDate>), never as an RDF
  // attribute, so normalize-pdf.ts's `<tag>…</tag>` zero-fill sees it.
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n` +
    `      <pdfaid:part>2</pdfaid:part>\n` +
    `      <pdfaid:conformance>B</pdfaid:conformance>\n` +
    `    </rdf:Description>\n` +
    `    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    `      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(id.title)}</rdf:li></rdf:Alt></dc:title>\n` +
    `    </rdf:Description>\n` +
    `    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n` +
    `      <xmp:CreatorTool>${xmlEscape(id.creatorTool)}</xmp:CreatorTool>\n` +
    `      <xmp:CreateDate>${created}</xmp:CreateDate>\n` +
    `      <xmp:ModifyDate>${created}</xmp:ModifyDate>\n` +
    `      <xmp:MetadataDate>${created}</xmp:MetadataDate>\n` +
    `    </rdf:Description>\n` +
    `    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n` +
    `      <pdf:Producer>${xmlEscape(id.producer)}</pdf:Producer>\n` +
    `    </rdf:Description>\n` +
    `  </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>\n`
  );
}

/**
 * Attaches Info dict, XMP `/Metadata`, `/OutputIntents` (with `iccProfile`
 * embedded as the destination profile) and the trailer `/ID` to `pdf`.
 * Call once, after all pages are drawn and before `save()`.
 */
export function applyPdfA2b(pdf: PDFDocument, iccProfile: Uint8Array, id: PdfaIdentity): void {
  // Info dictionary — set through pdf-lib so it owns the object; every
  // entry here has its XMP analogue in buildXmpPacket.
  pdf.setTitle(id.title);
  pdf.setCreator(id.creatorTool);
  pdf.setProducer(id.producer);
  pdf.setCreationDate(id.now);
  pdf.setModificationDate(id.now);

  const ctx = pdf.context;

  const xmp = Buffer.from(buildXmpPacket(id), 'utf8');
  const metadataStream = ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  pdf.catalog.set(PDFName.of('Metadata'), ctx.register(metadataStream));

  const iccStream = ctx.flateStream(iccProfile, { N: 3 });
  const iccRef = ctx.register(iccStream);
  const outputIntent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  });
  pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(outputIntent)]));

  ctx.trailerInfo.ID = ctx.obj([PDFString.of(id.documentIdHex), PDFString.of(id.documentIdHex)]);
}
