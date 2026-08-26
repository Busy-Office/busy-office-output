# Session log

Newest first. One entry per Claude Code session. Template:

```
## YYYY-MM-DD — Stage N
- Did: <task> — evidence: <command → result>
- Open: <anything half-finished, or "nothing">
- Next: <recommended pickup>
```

---

## 2026-08-26 — Stage 0 (loop tick 10, dispatcher + Q6)
- Did: dispatcher pass (interactive — maintainer answered GATE-CARBONE
  in-session, processed immediately rather than waiting for tick%4).
  Maintainer decided "skip carbone": LibreOffice-as-production-dependency
  conflicts with "never gold-plate a renderer"; CCL license left unread as
  moot. GATE-CARBONE closed (not benchmarked, skipped by decision) —
  docs/HUMAN-GATES-LOG.md. ROADMAP.md carbone-author + CCL-read [HUMAN]
  tasks annotated SKIPPED (left unchecked, no DoD ran). docs/INBOX.md item
  moved to Processed. Then Q6: arb-chair drafted the ADR-000 recommendation
  (Option A / schema-first recommended, renderer choice deferred to
  ADR-002) into ADRs/000-template-authoring-model.md, all 5 decision
  drivers filled with RESULTS.md citations (drivers 2-4 explicitly marked
  unanswered/unanswered-by-choice, not fabricated). Two independent
  skeptics ran the verify stage: both passed 4-5 checks but both
  independently caught the same real defect — the draft called ADR-005
  "accepted"/"accepted-in-principle" three times, but ADRs/README.md:10
  lists it as "Proposed — skill tasks proceed." Corrected all three
  instances and added the missing RESULTS/README citation to driver 5.
  `npm run verify` green after the fix.
- Open: ROADMAP.md:40 (`/adr 000 round-table draft` checkbox) left
  **unticked** — both skeptics flagged a wording tension between the
  roadmap's literal DoD ("decision drivers all evidenced") and the draft
  legitimately marking 2-3 drivers "unanswered by choice," and recommended
  a human/arb-chair ruling rather than the loop self-approving. ADR-000
  Status remains Proposed; Decision line remains "Pending — human decides"
  per CLAUDE.md (only a human closes an ADR). Q6 is otherwise complete.
- Next: either the maintainer rules directly on whether ROADMAP.md:40 can
  be ticked given the "unanswered by choice" drivers, or the next
  dispatcher tick gets an arb-chair ruling on it. After that, Stage 0's
  remaining tasks are the human-only ones: decide ADR-000 itself, and (if
  Path A is chosen) ADR-001. Loop queue (docs/LOOP-PLAN.md Q1-Q6) is now
  fully exhausted — Stage 0 is human-blocked by design from here, not a
  loop failure.

## Loop ticks (noop entries — nothing runnable, logged without a full session entry)

- tick 9, 2026-08-26: noop — unchanged, GATE-CARBONE still open.
- tick 8, 2026-08-26: dispatcher noop (2/3 consecutive) — docs/INBOX.md still empty, no gates answered. Q6 still blocked on GATE-CARBONE.
- tick 7, 2026-08-26: noop — same as tick 6, GATE-CARBONE still unanswered.
- tick 6, 2026-08-26: noop — Q6 (/adr 000 draft) blocked on GATE-CARBONE (docs/INBOX.md empty, no soffice/libreoffice on this Mac). Queue empty otherwise.

## 2026-08-26 — Stage 0 (loop tick 5)
- Did: Q5 typst bench + RTL/CJK column. GATE-TYPST-INSTALL answered (typst
  0.15.1 found on PATH — installed outside the loop). Cold-process
  p50=100ms (n=15, 3 pages), vs container 459ms. Wrote
  spike/typst/rtl-cjk-smoke.typ mirroring the pdf-direct smoke test.
  **Caught and corrected my own tick-3 mistake**: the ar-SA verdict
  ("pdf-lib does no bidi/shaping") was a snap judgment from a small
  thumbnail, not rigorously checked. Redid it with isolated renders +
  explicit-codepoint order test + pixel-cluster analysis: pdf-lib's bidi
  and Arabic joining are actually correct, matching Typst almost exactly
  on pure Arabic text. The real defect is narrower: SFArabic.ttf has zero
  Latin/digit glyphs (a macOS OS-fallback-only font), and pdf-lib has no
  font-fallback chain, so Arabic+numbers — the normal shape of a real
  invoice — renders missing-glyph boxes for the numbers. Typst has
  automatic fallback and passes. Also found Typst's combined 3-script PDF
  is 21KB vs pdf-lib's 5.8MB CJK workaround. Corrected RESULTS.md and
  GATE-RTL-SHAPING (marked superseded, not silently rewritten) to reflect
  this.
- Open: GATE-CARBONE still blocks Q6 (the /adr 000 draft needs the
  carbone row filled, or an explicit "skip carbone" in docs/INBOX.md).
- Next: Q6 is the last queued item and it's gated. If GATE-CARBONE is
  still unanswered next tick, the loop goes fully human-blocked — nothing
  left in the queue that isn't waiting on you. Worth checking
  docs/INBOX.md; five gates are open, most consequential is now resolved
  (GATE-RTL-SHAPING, corrected) and GATE-BURST-WINDOW (no longer
  load-bearing per Q4's margin).

## 2026-08-26 — Stage 0 (loop tick 4, dispatcher)
- Did: dispatcher pass (tick % 4 == 0) — docs/INBOX.md Open section empty,
  no gate answered, nothing to rule on; no arb-chair spawn needed
  (consecutiveNoopDispatches now 1). Then Q4: parametrized bursting math —
  5/15/30/60-min windows for 8,000 docs vs pdf-direct's measured
  p50=12.1ms. Clears every window 3.1x-37.2x single-threaded (~97s total
  sequential). Conclusion: pdf-direct throughput is not the bottleneck at
  any plausible window; GATE-RTL-SHAPING is the real open question, not
  bursting.
- Open: GATE-BURST-WINDOW still unanswered but no longer load-bearing for
  the pdf-direct verdict; carbone/typst rows still need their gates.
- Next: Q5 — typst bench, blocked on GATE-TYPST-INSTALL (`brew install
  typst`); the loop will not self-install. If still blocked next tick,
  Q6 (/adr 000 draft) is also blocked on GATE-CARBONE — loop likely goes
  human-blocked from here until you answer something in docs/INBOX.md.

## 2026-08-26 — Stage 0 (loop tick 3)
- Did: Q3 RTL/CJK smoke test for pdf-direct — real rasterized evidence, not
  a checkbox rubber-stamp. th-TH PASS. ja-JP FAILS with subsetting on
  (pdf-lib TrueType subsetter bug on a 20k-glyph composite-glyph font ->
  tofu), only passes full-font-embedded (~5.7MB/font). ar-SA FAILS: no
  bidi reordering, no Arabic contextual joining — pdf-lib draws RTL text
  in mirrored logical order. Wrote spike/pdf-direct/ttc-split.js (.ttc ->
  standalone sfnt, dependency-free) + rtl-cjk-smoke.js (`npm run
  spike:rtl-cjk`). RESULTS.md updated with full findings + reproduce steps.
  Logged GATE-RTL-SHAPING (open) — real ADR-000/002 decision point.
- Open: pdf-lib is not provably sufficient as the sole volume renderer for
  non-Latin scripts; GATE-RTL-SHAPING needs a human call (shaping layer /
  second renderer / defer scope).
- Next: Q4 — parametrized bursting math table (window still open via
  GATE-BURST-WINDOW).

## 2026-08-26 — Stage 0 (loop tick 2)
- Did: Q2 pdf-direct bench on target hardware — MacBook Air / Apple M4 /
  24GB / macOS 26.5.2 / Node v26.3.0. p50=12.1ms p95=14.5ms mean=12.3ms
  (n=30). RESULTS.md hardware + gate-5 pdf-direct row filled; bursting
  math shows pdf-direct alone clears 8,000 docs in ~97s single-threaded
  (window itself still open, GATE-BURST-WINDOW).
- Open: typst/LibreOffice not installed on this machine (GATE-TYPST-INSTALL,
  GATE-CARBONE).
- Next: Q3 — RTL/CJK smoke test (th-TH, ja-JP, ar-SA) in pdf-direct using
  macOS system fonts.

## 2026-08-26 — Stage 0 (loop tick 1)
- Did: Q1 bootstrap — `npm install` root + spike/pdf-direct (lockfiles
  committed, 0 vulns in prod deps); `npm run verify` green; `spike:data`
  run twice → byte-identical sha256 across both runs on this machine.
- Open: Q2 (pdf-direct bench on this Mac) next.
- Next: Q2 — render-engineer runs `npm run spike:pdf-direct`, fills
  RESULTS.md hardware section + gate-5 pdf-direct row.

## 2026-08-26 (later) — design consolidation (container)
- Did: docs/HLD.md landed in-repo (topologies T1-T3 + transactional outbox,
  RenderJob seam, standards-aware renderer routing); docs/UI-DESIGN.md (five
  principles, 6 sections / 11 screens, screen one-liners, absent-list);
  ADR-007 packaging (Proposed, drafted), ADR-008 licence (Proposed, stub);
  ROADMAP gained commercial gates C1-C3 + parking rule, console tasks in
  S3/S4/S5, embeddable-module+outbox task, thesis check; new agent
  console-designer; CLAUDE.md read order + UI rule.
- Open: unchanged Stage 0 human tasks (carbone bench, hardware re-measure,
  CCL read, ADR-000); ADR-008 is human-only.
- Next: still the carbone template + bench — nothing above unblocks without it.

## 2026-08-26 — Stage 0 (scaffold session, container)
- Did: repo scaffolded; pdf-direct spike implemented+verified (3 pages,
  p50=37.8ms, carried/brought-forward chain confirmed on rasterized page 2);
  typst spike implemented+verified (state-based running footer works,
  cold-process p50≈459ms); carbone harness + TEMPLATE.md ready (needs
  LibreOffice); schema contracts typecheck under --strict; ADRs 000–004
  drafted; Claude Code layer added (CLAUDE.md, 4 agents, 4 commands, settings).
- Open: carbone spike unrun; RTL/CJK smoke test; hardware re-measure; CCL
  licence read; ADR-000 undecided.
- Next: /next will point at authoring po-template.odt and running the carbone
  bench — that is the human-hardware task everything waits on.
