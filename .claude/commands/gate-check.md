---
description: Run a stage's gate commands and report pass/fail against ROADMAP.md
argument-hint: <stage number, e.g. 0>
---
Delegate to the corpus-qa agent. For stage $ARGUMENTS:

1. Read the "Exit gate" block of that stage in ROADMAP.md.
2. Execute every runnable check (npm run verify, spike benches, corpus runs).
   For criteria that are human judgments (e.g. "ADR-000 decided"), check the
   ADR file status and report the fact, not an opinion.
3. Output a table: criterion → command/evidence → PASS / FAIL / HUMAN-PENDING.
4. Only if every criterion is PASS or HUMAN-PENDING-with-human-signoff, state
   that the stage may close. Never tick ROADMAP checkboxes for criteria that
   did not PASS.
