/**
 * DRAFT — Layout IR, the seam of HLD §2. Shape depends on ADR-000 and ADR-001:
 *  - Path A + composition-side pagination: page-resolved boxes (below)
 *  - Path A + Typst: IR becomes emitted Typst markup, this file shrinks to a wrapper
 *  - Path B: no IR; delete this file
 * Kept minimal on purpose until those ADRs close.
 */
export interface LayoutIR {
  irVersion: string;
  pages: IRPage[];
}
export interface IRPage { width: number; height: number; boxes: IRBox[] }
export interface IRBox {
  x: number; y: number; w: number; h: number;
  text?: string; font?: string; size?: number; align?: 'l' | 'r' | 'c';
}
