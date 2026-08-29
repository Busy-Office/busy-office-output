/**
 * Shared helpers for the Stage 6 locale corpus cases (010-013). Flattens
 * `extractPdfWords`'s per-page word boxes into one reading-order array so a
 * test can assert both (a) that a locale-formatted substring actually
 * appears in the rendered PDF's extracted text, and (b) relative word
 * order (used by 011-locale-ja-jp.test.ts to prove address line reordering,
 * not just line *content*).
 */
import { extractPdfWords } from '@busy-office/render-typst';

/** All words across all pages, in reading order, as plain strings. */
export async function flattenedWords(pdfBytes: Uint8Array): Promise<string[]> {
  const pages = await extractPdfWords(pdfBytes);
  return pages.flatMap((p) => p.words.map((w) => w.text));
}

/** The full extracted text (all pages, words space-joined) — for substring/regex assertions that may span multiple `<word>` tokens. */
export async function flattenedText(pdfBytes: Uint8Array): Promise<string> {
  return (await flattenedWords(pdfBytes)).join(' ');
}

/** Index of the first word equal to `needle`, or -1. Throws if not found — callers want a hard failure, not a silent -1 comparison. */
export function indexOfWord(words: string[], needle: string): number {
  const idx = words.indexOf(needle);
  if (idx === -1) {
    throw new Error(`expected to find word "${needle}" in extracted PDF text; got: ${JSON.stringify(words)}`);
  }
  return idx;
}
