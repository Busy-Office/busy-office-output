# ADR-000 — Template authoring model

**Status:** Accepted — 2026-08-26 (maintainer decision)
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
  users author in the tool they know; this is the long-standing pattern for
  enterprise output authoring. Pagination, repeating headers, keep-with-next
  come from the file format.
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

1. **Is carried-forward-at-page-break a hard requirement for any Stage 3–4 document?**
   Yes for payslips and multi-page invoices/POs with running subtotals — this
   is the reference PO's own gate 2. Both schema-first renderers pass it
   (pdf-direct and Typst, gate matrix, `spike/RESULTS.md` §Gate matrix).
   Carbone's mechanism for this was never confirmed (see driver 3) — Option
   B's own text flags "no native office-format mechanism" as unverified.

2. **Who authors templates at the target organisation — developers or
   business users?**
   Unanswered in `RESULTS.md` — the "Who will actually author templates at
   the target org?" line under Authoring experience notes was never filled
   in. No named business-user template author exists yet for this project
   (single part-time maintainer, Stage 0). This driver currently has no
   evidence either way and should not be used to justify Option B until a
   real user is named.

3. **Does Carbone pass gates 1, 3, 4 on the reference PO, and at what ms/doc
   on real hardware?**
   **Unanswered by choice, not by evidence.** GATE-CARBONE was explicitly
   skipped by maintainer decision (`docs/INBOX.md`; `ROADMAP.md` line 35)
   because LibreOffice-as-production-dependency conflicts with the
   "never gold-plate a renderer" golden rule, not because Carbone was run
   and failed. Carbone has zero rows filled in the gate matrix, the
   bursting table, or the authoring notes. Any future re-evaluation must
   re-open GATE-CARBONE and actually run `npm run spike:carbone`, not infer
   a result from the vendor's published ~50ms/doc figure.

4. **Is the CCL compatible with the intended distribution of Busy Office
   Output?**
   **Unanswered by choice, not by evidence.** The licence-check line in
   `RESULTS.md` is blank; `LICENSE.md` was explicitly not read
   (`ROADMAP.md` line 38, skipped 2026-08-26, "moot: Carbone not adopted
   for Stage 0"). The known constraint from the ADR's own Option B text
   stands unverified in depth: CCL permits embedding but prohibits
   hosted-DGaaS use, which is a real risk for a project offering delivery
   as part of its runtime — this needs a full read before Path B or C is
   revisited, not a summary judgment.

5. **How much of the authoring burden should AI carry?**
   Favors Option A, though the supporting ADR is not yet closed. ADR-005
   (status per `ADRs/README.md`: **"Proposed — skill tasks proceed"**, not
   accepted) establishes text-diffable templates as the AI-leverage path:
   generation-from-sample plus a render-diff verification loop. Binary
   office templates (Option B) are AI-hostile — poor XML-in-zip patching,
   unreadable diffs — and the "Word is the builder" advantage Option B
   claims matters less once the AI is the builder. This driver is
   evidenced by a proposed-but-in-motion ADR (`ADRs/README.md` row for 005;
   its skill tasks already proceed) rather than by `spike/RESULTS.md` data
   — the one driver here not sourced from a Stage 0 spike, which is weaker
   support than a closed decision. The direction is right, but ADR-005
   itself is not yet a settled precedent, and this gap should be named
   explicitly rather than folded into the same "evidenced" bucket as
   drivers 1–4.

## Decision

**Accepted 2026-08-26: Option C (hybrid), scoped narrowly.** The runtime
(Stages 3–5) is built renderer-agnostic behind the `Renderer` interface in
`@busy-office/output-schema`, per Option C's architecture. But unlike
Option C's original "Carbone as renderer #1, fast to market" framing, the
maintainer's explicit instruction is: **schema-first (Option A: Typst /
pdf-direct) is the only renderer built now.** Carbone/Path B is *reserved*
behind the seam — the `RenderJob` union type accommodates it — but **not
adopted, not built, not benchmarked**, consistent with the skip-carbone
decision (`docs/INBOX.md`, GATE-CARBONE) and Option C's own cost clause:
"accept only if a concrete document type demands each model; do not build
both speculatively." No concrete document type has demanded Carbone yet
(driver 2, unanswered). Revisit only if a named user needs `.odt`/`.docx`
authoring — at that point GATE-CARBONE reopens for real (install
LibreOffice, author `po-template.odt`, run `npm run spike:carbone`, read
`LICENSE.md` in full) rather than being inferred from this ADR.

**Practical consequence:** for all Stage 1+ work, the active path is
schema-first. **ADR-001 (pagination location) is therefore live, not
moot** — it must be decided before Stage 1 locks its contracts, since
Option C's schema-path component is exactly Option A's architecture.
ADR-002 (volume renderer: Typst vs. pdf-direct vs. both) also stays open,
informed by the RTL/CJK findings below.

Reasoning tied to the drivers above (retained from the draft recommendation,
now adopted):

- Driver 1 (carry-forward) is satisfied by both schema-first renderers
  today, on measured evidence — pdf-direct (p50=12.1ms, p95=14.5ms, n=30,
  target hardware) and Typst (cold-process p50=100ms) both pass gates 1–4
  on the reference PO. Option A's text already accommodates both renderers
  under one authoring model (`JSON schema → IR → Typst or pdf-direct`), so
  choosing A does not force a premature pdf-direct-vs-Typst call — that
  split is real (RTL/CJK below) but belongs to ADR-002, not ADR-000.
- Driver 5 (AI leverage) points the same direction, though its supporting
  ADR-005 is only "Proposed — skill tasks proceed," not accepted:
  text-diffable templates are the only authoring model that lets
  generation + render-diff verification substitute for a builder. This is
  the single largest structural advantage Option A has over B, but it
  rests on an in-motion proposal, not a closed decision — weight it
  accordingly until ADR-005 itself closes.
- Drivers 3 and 4, which would be Option B's strongest supporting evidence,
  are **unanswered by choice** — GATE-CARBONE was closed by maintainer
  decision to skip, not by a benchmark. Recommending Option A does **not**
  rest on Carbone having failed; it rests on Option A's demonstrated gate
  passes plus ADR-005's AI-leverage case being sufficient on their own,
  with the Carbone comparison simply absent from the record.
- The RTL/CJK smoke test (`spike/RESULTS.md`, tick-5-corrected) shows a
  real, quantified cost inside Option A itself: pdf-direct has no
  font-fallback chain (Arabic+digit invoices fail with `.notdef` boxes
  unless hand-assembled complete font sets are used) and a TrueType
  subsetter bug on large composite-glyph CJK fonts (workaround: disable
  subsetting, ~5.7MB/font cost). Typst has neither gap and produces PDF/A +
  UA-1-tagged output by default where pdf-direct does not. Because Option A
  already permits both renderers behind one schema, this is an argument for
  a two-renderer split *inside* Option A (fast path / conformance-and-script
  path), not an argument against Option A itself — but it should be named
  now so ADR-002 doesn't reopen this ground.

**Strongest counter-argument to this recommendation (not hidden):**
Driver 2 is genuinely unanswered — no named business user requiring
office-tool template authoring exists yet, but if one does exist or
appears soon, Option A permanently forecloses non-technical authoring
until the Stage 7 builder is built (conditional, expensive, explicitly the
thing Option A's own "Con" line warns about). A maintainer who expects a
business-authoring requirement to surface soon should weight this higher
than the evidence above does, since nothing in Stage 0 rules it out — it
was simply never asked.

**Carbone / Option B status:** explicitly undemonstrated by choice, not by
evidence, and not rejected on the merits. GATE-CARBONE and the CCL licence
read remain open commitments, reserved behind the `Renderer` seam per
Option C's architecture but not scheduled, to be revisited only if a named
user needs `.odt`/`.docx` template authoring. Reopening requires actually
running `npm run spike:carbone` and reading `LICENSE.md` in full — this
ADR must not be cited later as if that evaluation happened.

**Decision:** Accepted. Option C (hybrid architecture), schema-first
(Option A) is the only renderer built for Stage 0–2+; Carbone reserved,
not adopted. See "Practical consequence" above — ADR-001 is now live.
