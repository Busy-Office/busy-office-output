/**
 * Cheap page-count read straight off compiled PDF bytes — no parsing
 * dependency. Counts `/Type /Page` object dictionaries while excluding
 * `/Type /Pages` (the page-tree node), confirmed against real `typst
 * compile` output. Used by corpus tests that only have the returned
 * Artifact bytes (not the .typ source) to check against. The renderer's own
 * overflow/page-cap guard (renderer.ts) uses the more authoritative
 * `totalPages` value Typst itself reports via the embedded overflow marker
 * (emit-typst.ts) — this function is the bytes-only fallback the task
 * explicitly allows for corpus assertions.
 */
export function countPdfPages(pdfBytes: Uint8Array): number {
  const text = Buffer.from(pdfBytes).toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}
