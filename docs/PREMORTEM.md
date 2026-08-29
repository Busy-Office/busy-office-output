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
