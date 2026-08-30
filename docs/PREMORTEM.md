**VOIDED 2026-08-30** — `GATE-S3-THESIS-CHECK` was removed as a formal
gate (docs/GAP-REGISTER.md GAP-13, docs/HUMAN-GATES-LOG.md). The
pre-registered 5-operator scoring ceremony below was judged the wrong
mechanism for a solo maintainer — real-operator validation still matters
and continues informally/continuously, just not as a blocking gate with
this scoring apparatus. The scoring sections below were never filled in
and are kept only as historical record of the abandoned mechanism. The
"Demo readiness (technical only)" section at the bottom remains accurate
and is not voided — it recorded a real, verified fact about the demo.

# Premortem — GATE-S3-THESIS-CHECK (DRAFT: maintainer owns the numbers)

**Discipline:** this file is frozen (committed) before operator demo #1
and scored after demo #5. Editing predictions after contact is gate
theater. The commit hash is the timestamp. Chat ≠ adoption: every
threshold below is a proposal until the maintainer sets it.

**Thesis under test (ADR-009):** operators of small/mid ERP estates want
an auditable output runtime — determination + trace, archive-as-
reproduction, idempotent delivery, governed templates — enough to run it,
and today they have no open-source option.

## Predictions — success shape

| #   | Prediction (edit the numbers, then freeze)              | Score |
| --- | ------------------------------------------------------- | ----- |
| P1  | ≥3/5 restate what it replaces, unprompted and correctly | /5    |
| P2  | ≥2/5 ask "can I run this now / where's the repo"        | /5    |
| P3  | ≥1/5 hands over a real (redacted) sample to migrate     | /5    |
| P4  | ≥2/5 have an "oh" moment at the trace or reprint screen | /5    |
| P5  | 0/5 ask for a visual template builder (GAP-04's bet)    | /5    |

## Predictions — failure shape (write these first; they hurt more)

| #   | Failure signal                                        | Threshold that means the thesis is wrong                                           |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| F1  | "our reporting tool already does this"                | ≥3/5 → wedge mispositioned, reframe before more demos                              |
| F2  | Audit/retention shrug — only rendering interests them | ≥3/5 → the spine isn't the wedge; revisit ADR-009                                  |
| F3  | "who maintains this?" is the blocking question        | ≥3/5 → adoption problem, not product problem; changes next milestone, not the code |
| F4  | Nobody can name a document they'd move first          | 5/5 → no entry point exists; kill-gate conversation                                |

## Scoring sheet (one row per operator, filled same day)

| Op  | Role / estate | P1  | P2  | P3  | P4  | P5  | F-signals | Verbatim that mattered |
| --- | ------------- | --- | --- | --- | --- | --- | --------- | ---------------------- |
| 1   |               |     |     |     |     |     |           |                        |
| 2   |               |     |     |     |     |     |           |                        |
| 3   |               |     |     |     |     |     |           |                        |
| 4   |               |     |     |     |     |     |           |                        |
| 5   |               |     |     |     |     |     |           |                        |

## Decision rule (set before demo 1)

- **Proceed** (close GATE-S3 as MET): ≥3 of P1–P5 hit, no F-threshold
  crossed. Stage 7 triggers then advance on their own evidence.
- **Reframe** (gate stays open): predictions miss but a consistent
  alternative wedge appears in the verbatims → one repositioning pass,
  then a second 5-operator round. One reframe maximum.
- **Kill-gate conversation** (the honest branch): F4, or ≤1 prediction
  hit with no coherent reframe. The project's own rule: declaring
  failure needs the same evidence bar as declaring success — this file
  is that bar.

## Trigger feed tally (side effect, not the goal)

| Stage 7 track            | Needs                     | Collected |
| ------------------------ | ------------------------- | --------- |
| 1 — template-from-sample | 3 real templates authored | 0         |
| 2 — adjust-assist        | 5 asks by name            | 0         |
| 3 — shadow parity        | 1 named legacy estate     | 0         |

## Demo readiness (technical only — not operator evidence)

2026-08-29: the demo itself confirmed working end-to-end, in a fresh
`podman` container built from this repo's `Dockerfile` (zero external
services beyond the baked-in `typst` binary) — not a re-assertion of an
older claim, run again today. `POST /event` on a real purchase-order
fixture → HTTP 202 in 28–67ms, real rule trace (6 rules evaluated,
correct one fired), real Typst render, PDF/A-2b archived, delivery job
enqueued. Screens visually confirmed in an actual browser (not just
curl): Overview ("Nothing needs attention"), Registry (both fired
events listed), Document detail (full audit trail: docId, business
event key, templateVersion/rendererVersion, archiveRef, retentionUntil,
PDF/A-2b + veraPDF-verified, delivery history) and the reprint
trichotomy (Reproduce correctly refuses without a proxy-asserted actor
identity — GAP-24 — rather than guessing one; Regenerate/Reissue
correctly shown as ERP-caller-only). This is readiness evidence only —
it says the demo works, not what an operator thinks of it. The
Predictions/Scoring/Decision sections above are unchanged and still
entirely unscored.
