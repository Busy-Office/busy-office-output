# Inbox — human → loop channel

Drop anything here in plain text (decisions, answers to gates, new
requirements, "skip carbone", "window is 30 min", links). The dispatcher
(every 4th tick) reads the **Open** section, gets an `arb-chair` ruling on
what it means for ROADMAP.md, updates the roadmap, then moves the item to
**Processed** with a one-line disposition. Never edited by the loop except
that move.

## Open

## Processed

- GATE-S5-CLOSE + GATE-S5-RULINGS + GAP-13 scope: maintainer ruled directly
  in chat, 2026-08-29 (not via this file — logged here for the record,
  mirroring the GATE-S1-PREWORK pattern). ADR-007's two addenda (OutputPort
  v1 surface; v1.1 reprint verbs) Accepted as drafted, no changes. All
  seven GATE-S5-RULINGS items ratified at their stated defaults:
  (1) through-the-lifecycle, (2) two SoD pairings/submitter-may-publish,
  (3) regenerate logs on failed composition, (4) STRANDED_AFTER_MS=5min,
  (5) no auto-retire-on-publish (GAP-20 closed), (6) code is the surface
  for retire/submit (GAP-25 closed), (7) UUID nonce confirmed correct.
  GAP-13's Stage-5 exception read broadly — covers Stage 5's close and
  Stage 6's start, not just the building already done. Stage 5 marked
  CLOSED in ROADMAP.md same date; Stage 6 unblocked. ADRs/007-*.md,
  ADRs/README.md, docs/HUMAN-GATES-LOG.md, docs/GAP-REGISTER.md,
  CLAUDE.md, ROADMAP.md, two stale code comments all reconciled.
- skip carbone — decided 2026-08-26. GATE-CARBONE closed (not benchmarked,
  skipped by decision); ROADMAP.md carbone-author and CCL-read [HUMAN]
  tasks marked SKIPPED; Q6 (/adr 000 draft) unblocked.
- GATE-S1-PREWORK: yes, start Stage 1 — maintainer answered directly in chat,
  2026-08-27, full authorization. docs/HUMAN-GATES-LOG.md GATE-S1-PREWORK
  closed; all Stage 1 tasks unblocked except the Path B marker/formatter
  task, which stays out of scope per ADR-000 (Path A is the only renderer
  built now, Carbone reserved/not adopted — building Path B speculatively
  now would violate ADR-000's own decision).
