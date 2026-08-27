---
name: template-from-sample
description: Given a rasterized image of a rendered document, produce a DocNode tree that reproduces it. Use when the user provides a document image/scan/screenshot and wants a Busy Office Output template generated from it (ROADMAP Stage 2 draft skill; Stage 4 track "Template-from-sample, productized" governs its production use).
---

# template-from-sample

Reconstruct a `DocNode` tree (`packages/schema/src/document/nodes.ts`) and,
where the visible values must be captured, a matching data example, from a
**rasterized image only** — no access to the original template source, the
original `DataContractEnvelope`, or any renderer internals for the document
in the image. This mirrors the real constraint: a user hands over a scan or
screenshot of a document produced by some other system, and this skill's job
is to get it into the schema-first pipeline (ADR-000 Option C).

This is Stage 2 scaffolding — ADR-005's AI-template-verifier depends on it
(every output here is verified structurally by `bo-output diff`, never
trusted unverified), and it is explicitly still `draft` per ADR-005's
lifecycle rule: "AI-generated or AI-patched templates are still templates —
same corpus gates, provenance recorded, edits enter the lifecycle as
draft." Nothing this skill produces is ever treated as `published`/`approved`
without a human review pass through the normal template lifecycle
(`docs/HLD.md`, Stage 5).

## Hard constraints (read before writing anything)

- **Nine frozen `DocNode` kinds only** — `document`, `section`, `text`,
  `fieldGrid`, `table`, `totals`, `header`, `footer`, `pageNumber`. See
  `packages/schema/src/document/nodes.ts`. If the image shows something that
  genuinely doesn't fit any of the nine, STOP and report the gap — do not
  invent a tenth kind. (The nine were frozen at the Stage 1 paper-test gate;
  a real gap is a schema-change proposal for a human, not something this
  skill decides.)
- **`docs/EXPRESSION-GRAMMAR.md`-conformant expressions only** — every
  `value`/`bind`/`key` is a dot-path (`header.poNumber`,
  `totals.grandTotal.amount`, `lines`), envelope-rooted (`schemaVersion`,
  `documentType`, `header`, `lines`, `totals`) or row-relative for table
  columns. No literals, no operators, no function calls, no `lines[0]`
  indexing. If a value in the image looks computed (e.g. a running balance),
  express it the same way the existing corpus templates do — carried-forward
  totals use `table.carryForward`, not a computed expression.
- **Never fabricate a `documentType`/schema.** If the image's document type
  doesn't match an existing contract in `packages/schema/contracts/`, say so
  and stop; do not invent a new schema file as a side effect of this skill.
- **Whitespace/typography is out of scope.** CLAUDE.md: "Never optimize
  typography during Stage 0-2; correctness and ms/doc only." Match structure
  and content, not exact pixel spacing, font, or kerning.

## Procedure

1. **Read the image.** Identify, top to bottom: repeating header content
   (→ `header` + `text`/`fieldGrid`), any label/value pairs in a fixed grid
   (→ `fieldGrid`, note the column count), the main repeating line-item table
   if present (→ `table`, note each column's header label, approximate
   alignment, and whether a running/carried-forward total column appears
   at page boundaries — set `table.carryForward` to the column's path if so),
   a totals block (→ `totals`, one row per visible total line, in order),
   and any footer/page-number text (→ `footer` + `pageNumber`, capture the
   format string, e.g. `"Page {page} of {pages}"`).
2. **Name the fields honestly.** For each piece of visible data, choose an
   expression path that would live under the matching contract in
   `packages/schema/contracts/*.schema.json` for this `documentType` — check
   the existing contract's shape (e.g. `purchase-order.schema.json`) rather
   than guessing field names from scratch when the document type matches one
   already defined.
3. **Transcribe representative values**, if a data example is requested
   too, into a plain object shaped like the matching `DataContractEnvelope`
   subtype (`PurchaseOrderData`/`InvoiceData`/`PayslipData` in
   `packages/schema/src/contract/data-contract.ts`, or a fresh shape if the
   `documentType` is new). Money fields are integer cents (CLAUDE.md
   convention) — a value shown as "$1,234.56" transcribes to `123456`, not
   `1234.56`. Never invent PII in place of what's actually visible; if the
   sample is a real document with real people's data, redact rather than
   transcribe (CLAUDE.md: "Never log data-contract payloads (payslips =
   PII)" — the same caution applies to what this skill persists).
4. **Assemble the `DocNode` tree** as a single `document`-kind root with
   `page: { size, margin }` inferred from the image's proportions (default
   to `A4` / `[40, 40, 40, 40]` if unclear — match an existing corpus
   template's page spec when the layout looks similar).
5. **Verify by rendering and diffing** — this is the step that makes the
   output trustworthy, not a nice-to-have:
   - Render the reconstructed tree through `TypstRenderer`
     (`packages/render-typst`) against the transcribed data example.
   - If a ground-truth PDF or a second rasterization of the original is
     available, run `npm run diff -- <original> <reconstructed>` (or call
     `diffPdfBytes`/`formatStructuralDiff` from `@busy-office/render-typst`
     directly) and read the report. A non-empty diff is not automatically
     wrong — a totals label that legitimately differs is a real diff — but
     every reported line must be explainable by looking at the image again.
   - If no ground truth is available (the common case — a scan of a
     document from some other system), rasterize your own reconstruction
     (`typst compile --format png`, `--ppi 144` is a reasonable default) and
     visually compare it side-by-side with the source image yourself before
     handing the tree back.
6. **Report what you produced**: the `DocNode` tree, the data example (if
   any), the rendered/rasterized proof, and an explicit list of anything you
   were unsure about or had to guess — the human reviewer needs that list to
   do a real review, per ADR-005's provenance requirement.

## What "done" looks like

A `DocNode` tree that a human can drop into a template's `document.ts`
(mirroring `test/corpus/purchase-order/template.ts`'s shape), a data example
that renders it without errors, and — when a ground-truth render exists to
compare against — a `bo-output diff` report that is either empty or fully
explained. The tree enters the system as `draft`, same as any other
AI-authored or AI-patched template (ADR-005); it is never treated as
verified just because this skill produced it.

## Known limitation of this skill definition

This document is instructions for a *future* Claude Code session that has
image-reading access to the specific sample in question. It cannot be
exercised standalone right now — the round-trip proof for Task B
(`test/corpus/purchase-order/009-template-from-sample-roundtrip.test.ts`)
is a mechanical stand-in: it hand-writes a reconstructed tree (playing the
role of "what following this procedure would produce") and proves the
*convergence check* — rendering + diffing — is real and automated. It does
not prove an agent with only pixels, following only this document, would
independently arrive at the same tree. See that test file's header comment
for the full honesty accounting.
