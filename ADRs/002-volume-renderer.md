# ADR-002 — Volume renderer for bursting

**Status:** Proposed. Spike evidence so far favours pdf-lib.

## Context
Stage 4's gate: 8,000 payslips inside the stated window. Spike measurements
(container, indicative): pdf-lib in-process p50 ≈ 38ms/doc → ~5 min
single-threaded for 8,000. Typst cold-process ≈ 459ms — needs a warm/batched
measurement before it can compete here. Carbone publishes ~50ms with 3 warm
LibreOffice workers. jsreport documents Chromium hanging past ~4,000 table
rows; Chromium is excluded from volume duty.

## Standards criterion (ADR-006)
Archived artifacts must be PDF/A-2b, veraPDF-validated. Typst ≥0.14 exports
all PDF/A parts plus PDF/UA-1 with built-in validation; LibreOffice exports
A-1b/2b/3b; pdf-lib has no conformance support — our spike's non-embedded
standard fonts are already a violation, so pdf-direct staying the volume
renderer implies a font-embedding + XMP + OutputIntent workstream in Stage 2.

## Decision
_Pending real-hardware numbers in spike/RESULTS.md. Default: pdf-lib direct
writer behind the Renderer interface, selected per-template._
