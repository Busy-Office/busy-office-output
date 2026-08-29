# ADR-002 — Volume renderer for bursting

**Status:** Accepted 2026-08-29 — decided directly by the maintainer in chat,
on the real measurement below (gap register GAP-03).

## Context

Stage 4's gate: 8,000 payslips inside the stated 30-minute window
(GATE-BURST-WINDOW, decided 2026-08-27). This ADR was originally drafted on
Stage 0 container numbers that favoured pdf-lib (pdf-direct in-process
≈38 ms/doc vs Typst cold-process ≈459 ms) and said "Pending real-hardware
numbers." Those numbers now exist, and were superseded twice: first by the
Stage 2 single-render bench (Typst warm p50 ≈123 ms on this hardware), then
— decisively — by the Stage 4 real-pipeline measurement:

**8,000 payslips run to completion through the full pipeline** (contract
validation, determination, transactional-outbox mint, Typst render including
the overflow-guard query, FS archive + registry update, delivery enqueue),
Typst-only, single-process, MacBook Air M4: **1118.7 s = 18.64 min,
139.8 ms/doc, 1.61x inside the 30-minute window.** Concurrency-4
(extrapolated from N=2,000): 6.5 min, 4.62x. Render is 99% of the per-doc
cost (138.7 of 139.8 ms). Full section: `docs/RESULTS.md` §Bursting — real
pipeline. Measured, not projected.

pdf-direct (pdf-lib) exists only in the deleted Stage 0 spike — there is no
runtime renderer for it. Its Stage 0 number (12.1 ms/doc single-render) is
real but incomparable: it did not archive, did not carry PDF/A-2b
conformance (non-embedded standard fonts are already a violation per
docs/STANDARDS.md), and reaching A-2b would be a fonts + XMP + OutputIntent
workstream.

## Standards criterion (ADR-006)

Archived artifacts must be PDF/A-2b, veraPDF-validated in CI. Typst ≥0.14
exports all PDF/A parts with built-in validation — the corpus gate already
proves this on every render (`packages/render-typst/src/verify-pdfa.ts`, CI
run 33229511242 green). pdf-lib has no conformance support; any pdf-direct
renderer must earn A-2b before it can archive anything.

## Decision

**Typst is the volume renderer. The window clears with margin Typst-only,
with no second renderer built.** This is the default for every document
type, per-template (renderer stays a template property, never global —
docs/UI-DESIGN.md absent-list).

**pdf-direct is retained as a scheduled Stage 4 task, not dropped** — the
maintainer's explicit choice over the "reserved-not-adopted" alternative.
Rationale: a faster second path for simple, single-page, high-volume bursts
where Typst's ~140 ms/doc is the entire cost and a ~10x-faster in-process
renderer would matter once real SLAs tighten below what concurrency alone
reaches. The Stage 4 ROADMAP task carries its full DoD: a
`packages/render-pdf-direct` renderer behind the same `Renderer` interface,
**PDF/A-2b via embedded TTF + XMP + OutputIntent, veraPDF-clean in the
corpus gate** — it does not ship without that, per ADR-006's "no compliance
claim without a validator." Until it lands, Typst carries every document
type; the routing rule (which templates go to pdf-direct) is decided when
the renderer exists, not now.

## Consequences

- Stage 4's exit gate condition "ADR-002 closed" is met.
- Stage 4 gains the pdf-direct task (ROADMAP.md). Its DoD is the
  compliance workstream, not a speed demo — a pdf-direct that renders fast
  but fails veraPDF is not done.
- The routing rule ADR-001 left to "ADR-002 latest" — which document types
  pdf-direct may serve — is deferred to the task that builds it, and stays
  bounded by ADR-001: multi-page, carry-forward, and non-Latin documents
  are Typst's regardless.
