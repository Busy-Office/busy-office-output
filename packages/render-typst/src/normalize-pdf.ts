/**
 * Determinism normalization (CLAUDE.md, ROADMAP Stage 2): zero out
 * CreationDate, ModDate, and the trailer document ID before hashing/
 * comparing rendered PDFs, so two renders of identical input are
 * byte-identical afterward. Placed here (not packages/schema, which stays
 * dependency-free and renderer-agnostic in its own right) because it is
 * genuinely PDF-format logic, not Typst-specific — any future renderer that
 * emits PDF bytes can reuse this file directly; nothing in it assumes
 * Typst's markup or CLI.
 *
 * Implementation is direct byte-scanning over the trailer/info-dict
 * structure, no PDF-parsing dependency: `/CreationDate(...)`, `/ModDate(...)`
 * and `/ID[(...)(...)]` are simple, textually-located tokens (confirmed
 * against real `typst compile` output — see packages/render-typst's report).
 * Each match is a PDF literal string `(...)`; the byte length of the file
 * MUST NOT change (object byte-offsets elsewhere in the xref table depend on
 * it), so every replacement zero-fills the inside of the parens to the exact
 * original length rather than substituting a differently-sized placeholder.
 * A dependency-free byte scan was sufficient — no devDependency was needed
 * for this step.
 *
 * Typst also embeds a second, independent source of nondeterminism: an
 * uncompressed XMP metadata stream (`<x:xmpmeta>...`) carrying
 * `<xmp:ModifyDate>`/`<xmp:CreateDate>` (ISO-8601, second-resolution — so
 * two renders a second apart differ) and `<xmpMM:InstanceID>`/
 * `<xmpMM:DocumentID>` (base64, presumably derived from the same random
 * document ID as the trailer `/ID`, which itself differs per render). This
 * was NOT discoverable from CLAUDE.md's normalization note (which only
 * names CreationDate/ModDate/doc ID) or from inspecting one PDF at a
 * glance — it surfaced empirically: two renders of byte-identical input
 * only ~1s apart, normalized by the three trailer/info-dict fields alone,
 * still failed a byte-equality check (see the render-typst corpus test
 * flake this fixed). All four XMP tags are zero-filled the same way.
 *
 * A THIRD source surfaced empirically once `typst compile` was run with
 * `--pdf-standard a-2b` (Stage 2 PDF/A task, docs/STANDARDS.md Tier 2):
 * PDF/A's XMP profile adds an `<xmpMM:History>` sequence of `<rdf:li>`
 * events (Typst emits "saved" and "converted" entries), each carrying its
 * own `<stEvt:when>` timestamp and `<stEvt:instanceID>` — same shape of
 * nondeterminism as the tags above but a distinct tag name, so the
 * existing zero-fill list didn't cover it. Caught the same way: a
 * multi-page corpus render (004, ~3.5s compile) two renders apart no
 * longer byte-matched after normalization once `--pdf-standard` was added,
 * even though the single-page case (fast enough to land in the same wall
 * clock second) happened not to show it. Both tags are zero-filled the
 * same way, once per `<rdf:li>` occurrence (`replaceAll`-style via the
 * global regex flag).
 */

const LATIN1 = 'latin1';

function zeroFillInsideParens(source: string, regex: RegExp, groupCount: number): string {
  return source.replace(regex, (whole, ...groups: unknown[]) => {
    let out = whole as string;
    // Replace from the last group to the first so earlier offsets in `whole` stay valid.
    for (let i = groupCount; i >= 1; i--) {
      const g = groups[i - 1] as string;
      const idx = out.lastIndexOf(g);
      out = out.slice(0, idx) + '0'.repeat(g.length) + out.slice(idx + g.length);
    }
    return out;
  });
}

/** Returns a copy of `pdfBytes` with CreationDate, ModDate, and the trailer /ID zeroed — same byte length. */
export function normalizePdf(pdfBytes: Uint8Array): Uint8Array {
  let text = Buffer.from(pdfBytes).toString(LATIN1);

  text = zeroFillInsideParens(text, /\/CreationDate\(([^)]*)\)/g, 1);
  text = zeroFillInsideParens(text, /\/ModDate\(([^)]*)\)/g, 1);
  text = zeroFillInsideParens(text, /\/ID\s*\[\s*\(([^)]*)\)\s*\(([^)]*)\)\s*\]/g, 2);

  text = zeroFillTag(text, 'xmp:ModifyDate');
  text = zeroFillTag(text, 'xmp:CreateDate');
  text = zeroFillTag(text, 'xmp:MetadataDate');
  text = zeroFillTag(text, 'xmpMM:InstanceID');
  text = zeroFillTag(text, 'xmpMM:DocumentID');
  text = zeroFillTag(text, 'stEvt:when');
  text = zeroFillTag(text, 'stEvt:instanceID');

  return new Uint8Array(Buffer.from(text, LATIN1));
}

function zeroFillTag(source: string, tag: string): string {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  return source.replace(re, (whole, inner: string) => whole.replace(inner, '0'.repeat(inner.length)));
}
