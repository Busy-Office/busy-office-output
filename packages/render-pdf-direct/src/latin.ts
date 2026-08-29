/**
 * The "Latin-only" half of the pdf-direct routing rule (ADR-001: non-Latin
 * documents are Typst's — docs/RESULTS.md's RTL/CJK smoke test showed
 * pdf-lib's subsetter breaking on large composite-glyph CJK fonts and
 * having no font fallback for Arabic+digits). This renderer does not try
 * to solve that; it REFUSES text outside the Latin range so a mis-routed
 * document fails loudly instead of rendering .notdef boxes (which would be
 * a Gate-4-shaped silent failure: content the reader cannot see).
 *
 * "Latin" here is a fixed, explicit codepoint allow-list, not "whatever the
 * font happens to have a glyph for" — DejaVu Sans covers Greek and Cyrillic
 * too, but those are out of the rule ADR-001 states, and the rule must be
 * checkable without knowing which font is embedded. The font-coverage
 * check (does DejaVu actually have this glyph?) is a second, independent
 * guard applied by the layout pass.
 */

const LATIN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0009, 0x000d], // tab, LF, CR — whitespace controls (rendered as spaces/breaks, never glyphs)
  [0x0020, 0x007e], // Basic Latin
  [0x00a0, 0x024f], // Latin-1 Supplement, Latin Extended-A, Latin Extended-B
  [0x2010, 0x2027], // dashes, quotes, bullet, ellipsis
  [0x2030, 0x203a], // per-mille, prime, guillemets
  [0x20ac, 0x20ac], // euro sign
  [0x2122, 0x2122], // trade mark sign
];

export function isLatinCodePoint(cp: number): boolean {
  for (const [lo, hi] of LATIN_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** Returns the first non-Latin codepoint in `text`, or `undefined` if the whole string is Latin. */
export function firstNonLatinCodePoint(text: string): number | undefined {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!isLatinCodePoint(cp)) return cp;
  }
  return undefined;
}
