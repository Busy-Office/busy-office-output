# ADR-001 — Where does pagination happen?

**Status:** Accepted — 2026-08-27 (maintainer decision)
**Decides:** live per ADR-000's "Practical consequence" — schema-first
(Option A) is the active path, so this is not moot.

## Context
If pagination lives in composition, the Layout IR is page-resolved: every
renderer produces identical page breaks, IR diffs are structural ("expected 2
pages, got 3"), and overflow is a build failure. Cost: a real text-measurement
engine (font metrics, line breaking). The pdf-direct spike already implements a
greedy wrap over pdf-lib font metrics — evidence the cost is modest for the
component set we allow. If pagination lives in the renderer (Typst owns it
natively), we forfeit cross-renderer page-break identity and the conformance
test in `test/conformance/`.

**Research update (deep-research pass, 2026-08-27, informing this decision):**
Typst's pagination is genuinely renderer-side and automatic (fixed-height
pages paginate on overflow; `auto`-height pages grow infinitely instead —
used for continuous content, not pagination). Its "regions" layout model
gives layout code exact positional information *during* layout, which is
what lets it break table cells correctly across pages and enforce
tagging-validity at compile time (refuses to claim PDF/UA-1 conformance
unless the document structurally qualifies). TeX's classic model, by
contrast, decouples linebreaking (composition-side) from pagebreaking as a
separate stage — flexible rearrangement, but no positional awareness
during composition. This is the real architectural fork: elements that can
be repositioned after layout can't know their position; elements that know
their position during layout can't be moved afterward. Building a
composition-side layout engine (Option 1) means re-solving what Typst's
tighter coupling already solves well; no other FOSS option surfaced in the
research that changes this trade.

## Options
1. Composition-side (Yoga or hand-rolled measure + break; Satori is the reference)
2. Renderer-side (Typst); IR becomes emitted Typst markup
3. Hybrid: composition measures and breaks; renderers honour breaks, never re-flow

## Decision

**Accepted 2026-08-27: Option 2 (renderer-side), scoped by document type —
not forced cross-renderer parity.**

Typst owns pagination natively for any document with real multi-page
layout, carry-forward totals, or non-Latin scripts — exactly the cases
`spike/RESULTS.md`'s RTL/CJK section shows pdf-direct struggling with (no
font-fallback chain, TrueType subsetter bug on composite-glyph CJK fonts).
pdf-direct remains available for simple, low-page-count, high-volume bursts
where pagination correctness barely matters and its ~8x throughput
advantage (p50=12.1ms vs. Typst's cold p50=100ms, `spike/RESULTS.md` §Gate
matrix) is the deciding factor. This is the "fast path /
conformance-and-script path" split ADR-000's Decision section already
named as a likely ADR-002 outcome — this ADR adopts that split explicitly
for pagination purposes.

**Reasoning:**
- CLAUDE.md's golden rule — "the runtime is the product... never
  gold-plate a renderer" — argues directly against Option 1/3. A
  hand-rolled or hybrid composition-side layout engine means owning font
  metrics, line-breaking, keep-with-next, and widow/orphan logic that
  Typst already provides, compile-time-enforced. For a single part-time
  maintainer, that ongoing cost is exactly the scope Stage 0 exists to
  cut.
- The evidence does not show one renderer subsuming the other: pdf-direct
  wins decisively on raw throughput, Typst wins decisively on pagination
  correctness and compliance (PDF/A range, tagged PDF, PDF/UA-1). Rather
  than force parity between two renderers with genuinely different
  strengths, this decision routes documents to the renderer suited to
  them.

**Consequence — the `test/conformance/` cross-renderer page-break-identity
test named in this ADR's original Context is retired as a global
guarantee.** It does not apply across pdf-direct and Typst, since they are
no longer expected to agree structurally. It may still apply *within* a
single renderer's version upgrades, if that becomes useful later.

**Named risk, not hidden:** if a single document type later needs both
renderers interchangeably (e.g. compliance-tier routing mid-stream for the
same document instance), this decision does not provide that — it would
require revisiting toward Option 1/3. Nothing in Stage 0's evidence names
this requirement today; it is cheaper to revisit later than to build
composition-side pagination speculatively now.

ADR-002 (volume renderer) inherits this document-type-scoped-split framing
directly and should decide the concrete routing rule (which document
types/locales go to which renderer).
