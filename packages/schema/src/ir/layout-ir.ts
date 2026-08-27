/**
 * Layout IR, the seam of HLD §2 — CLOSED for the Typst path (ADR-000 Option C
 * hybrid Accepted 2026-08-26; ADR-001 Accepted 2026-08-27: pagination is
 * renderer-side, owned by Typst, not composition). Per ADR-001's decision and
 * this file's own former DRAFT comment ("Path A + Typst: IR becomes emitted
 * Typst markup, this file shrinks to a wrapper"), the IR is now a thin
 * wrapper: a bound `DocNode` tree plus the `DataContractEnvelope` it renders
 * against. `packages/render-typst` walks `root`, evaluates every bound
 * expression (packages/schema/src/expression/parse.ts syntax, evaluated by
 * render-typst's own evaluator — this package stays parse-only) against
 * `data`, and emits Typst markup — no page-resolved-boxes shape belongs
 * here, since Typst decides page breaks, not this package.
 *
 * The previous page-resolved-boxes shape (`IRPage`/`IRBox`) belonged to a
 * different renderer style — composition-side pagination (pdf-direct) —
 * which ADR-001 did NOT select as the Path A default. It has been removed
 * from this file; a future composition-side renderer would need its own IR
 * shape, not this one.
 *
 * Zero runtime dependencies preserved: this file only defines types.
 */
import type { DocNode } from '../document/nodes.js';
import type { DataContractEnvelope } from '../contract/data-contract.js';

export interface LayoutIR {
  irVersion: string;
  /** Must be `{ kind: 'document' }` — the root of the bound template tree. */
  root: DocNode;
  /** The envelope every expression in `root` is evaluated against. */
  data: DataContractEnvelope;
}
