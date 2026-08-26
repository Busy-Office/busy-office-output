# ADR-000 — Template authoring model

**Status:** Proposed — must close at the end of Stage 0
**Decides:** the single largest fork in the project. ADR-001 and ADR-002 are moot or trivial under Path B.

## Context

The reference survey (`busy-office-output-references.md`) found that document
*rendering* is a solved space, but split across two incompatible authoring models.
Carbone demonstrated that the office-template model is production-viable at
ERP volume (~50ms/doc published; our own pdf-lib spike measured 38ms for the
code path). What no open-source project provides is determination, archive,
reprint semantics, and audit — the runtime. **The runtime (Stages 3–5) is
invariant under this decision.** This ADR decides only how templates are
authored and rendered.

## Option A — schema-first

JSON document schema → composition → Layout IR → renderer (Typst or pdf-direct).

- **Pro:** templates are text — Git-diffable, reviewable in a PR, structurally
  testable (`bo-output diff` compares IR trees, not pixels). **LLM-native**:
  generation-from-sample and conversational patching verify through the
  render-diff loop (ADR-005) — the builder problem dissolves. Expression language
  is a designed, allowlisted grammar. Carry-forward subtotals proven working
  (both spike renderers pass gate 2). No LibreOffice in production.
- **Con:** we own layout (or delegate to Typst and inherit its model). Business
  users cannot author templates; eventually someone asks for a builder
  (roadmap Stage 7, conditional, expensive).

## Option B — office-template (Carbone model)

.odt/.docx authored in LibreOffice/Word with `{d.field}` markers → injection →
LibreOffice PDF conversion.

- **Pro:** no layout engine, no component library, no builder — ever. Business
  users author in the tool they know; this is how SAP output has always worked.
  Pagination, repeating headers, keep-with-next come from the file format.
  Worker pool, crash restart, retry already built. ~60% less product code.
- **Con:** templates are binary zips — no meaningful diff, no structural test;
  review means opening the file. LibreOffice becomes a pinned production
  dependency with a font/version matrix. CCL licence is not OSI-approved
  (embedding permitted; hosted-DGaaS prohibited — read `LICENSE.md` in full).
  Community edition trails Enterprise by a major version. AI leverage is
  weak: LLMs patch XML-in-zip poorly, diffs are unreadable, and "Word is the
  builder" matters less once the AI is the builder (ADR-005). **Gate 2
  (carried-forward subtotal at page break) has no native office-format
  mechanism** — spike must confirm whether that requirement is real and hard.

## Option C — hybrid (likely landing zone)

Build the runtime (Stages 3–5) renderer-agnostic behind the `Renderer`
interface in `@busy-office/output-schema`. Ship **Carbone as renderer #1**
(fast to market, business-authored templates) and keep the schema path as
renderer #2 for documents that need carry-forward, structural testing, or
Git-native review (payslips, high-volume bursting via pdf-direct). The
`RenderJob` union type already accommodates both.

- **Cost of C:** two template models to document and govern. Accept only if a
  concrete document type demands each model; do not build both speculatively.

## Decision drivers (fill from spike/RESULTS.md)

1. Is carried-forward-at-page-break a hard requirement for any Stage 3–4 document?
2. Who authors templates at the target organisation — developers or business users?
3. Does Carbone pass gates 1, 3, 4 on the reference PO, and at what ms/doc on real hardware?
4. Is the CCL compatible with the intended distribution of Busy Office Output?
5. How much of the authoring burden should AI carry? (ADR-005 — strongly
   favors text templates; weakens Path B's Word-as-builder advantage)

## Decision

_Pending Stage 0._
