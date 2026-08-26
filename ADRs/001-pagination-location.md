# ADR-001 — Where does pagination happen?

**Status:** Proposed. Depends on ADR-000; moot under Path B (LibreOffice paginates).

## Context
If pagination lives in composition, the Layout IR is page-resolved: every
renderer produces identical page breaks, IR diffs are structural ("expected 2
pages, got 3"), and overflow is a build failure. Cost: a real text-measurement
engine (font metrics, line breaking). The pdf-direct spike already implements a
greedy wrap over pdf-lib font metrics — evidence the cost is modest for the
component set we allow. If pagination lives in the renderer (Typst owns it
natively), we forfeit cross-renderer page-break identity and the conformance
test in `test/conformance/`.

## Options
1. Composition-side (Yoga or hand-rolled measure + break; Satori is the reference)
2. Renderer-side (Typst); IR becomes emitted Typst markup
3. Hybrid: composition measures and breaks; renderers honour breaks, never re-flow

## Decision
_Pending — decided by which Path A renderer wins the spike, if Path A wins at all._
