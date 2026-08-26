# Session log

Newest first. One entry per Claude Code session. Template:

```
## YYYY-MM-DD — Stage N
- Did: <task> — evidence: <command → result>
- Open: <anything half-finished, or "nothing">
- Next: <recommended pickup>
```

---

## 2026-08-27 — Stage 0 CLOSED (exit gate passed, spike/ deleted)
- Did: ran `/gate-check 0` via corpus-qa (read-only pass): 3/4 exit-gate
  criteria PASS (ADR-000 evidenced, ms/doc measured warm, bursting math
  closes), 1 FAIL (spike/ not yet deleted). Applied the fix: moved
  `spike/RESULTS.md` → `docs/RESULTS.md` (git mv, preserves history),
  deleted the rest of `spike/` (`bench.js`, `carbone/`, `data/`,
  `pdf-direct/`, `typst/`, `README.md` — all disposable by
  `spike/README.md`'s own stated policy). Cleaned up what the deletion
  broke rather than leaving it half-done: removed the now-dead `spike:*`
  scripts from `package.json`; updated `CLAUDE.md`'s Commands section,
  its stale "ADR-000 is open" golden rule (now factually wrong — fixed to
  cite the real gate, GATE-S1-PREWORK, that governs early Stage 1 work),
  and its status line; updated `README.md`'s "Start here" list and status
  blurb (was still "pre-Stage-0" with a broken `spike/README.md` link);
  repointed `spike/RESULTS.md` citations to `docs/RESULTS.md` in
  ADRs/000, 001, 002. Left historical log entries (SESSION-LOG,
  HUMAN-GATES-LOG prior rows) untouched — those correctly describe what
  was true when written. `npm run verify` green throughout.
  ROADMAP.md's exit-gate block now shows all 4 PASS with citations; Stage
  0 heading marked CLOSED 2026-08-27.
- Open: `GATE-S1-PREWORK` still open (default NO) — Stage 1 has not
  formally started. `.claude/agents/render-engineer.md`,
  `.claude/agents/corpus-qa.md`, and `.claude/skills/build-loop/SKILL.md`
  still reference the now-deleted `spike/` paths/status — left as-is,
  lower-priority documentation drift, not load-bearing for any command or
  gate.
- Next: Stage 1 work (contracts, variant resolver, Tier-1 codes) once
  `GATE-S1-PREWORK` is answered, or ADR-002's routing rule (pdf-direct vs
  Typst by document type/locale) — either is a live path now.

## 2026-08-27 — Stage 0 (GATE-BURST-WINDOW closed)
- Did: maintainer decided the bursting window: **30 minutes** for 8,000
  docs. Chosen as the point where both renderers clear single-process
  with no worker-pool fan-out: pdf-direct 18.6x margin, Typst (cold,
  single-process) 2.25x margin — and Typst's margin was the deciding
  constraint given ADR-001 routes multi-page/carry-forward/non-Latin
  documents (a real batch's likely shape) to Typst, not just pdf-direct's
  fast path. Applied: docs/HUMAN-GATES-LOG.md GATE-BURST-WINDOW closed;
  spike/RESULTS.md bursting section filled with the decided window +
  achieved line; ROADMAP.md bursting-math checkbox ticked. While filling
  this in, caught and corrected a pre-existing arithmetic error in
  RESULTS.md: prose claimed Typst "clears the 5/15-min windows at 3x/9x
  margin," which doesn't reconcile with the required-ms/doc table
  (recomputed: Typst does NOT clear 5-min single-process, clears 15-min
  at only ~1.1x, clears 30-min at 2.25x — matches only the 30-min figure
  the original prose already had right). Corrected inline with a note;
  not load-bearing for the 30-min decision since that number was already
  right. `npm run verify` green.
- Open: GATE-S1-PREWORK still open. `spike/` deletion still blocked —
  need to re-check the Stage 0 exit gate (`/gate-check 0`) now that
  ADR-000, ADR-001, and GATE-BURST-WINDOW are all closed.
- Next: run `/gate-check 0` to see what (if anything) still blocks Stage
  0's exit; if clean, `spike/` deletion + RESULTS.md → docs/ move is the
  last Stage 0 task.

## 2026-08-27 — Stage 0/1 (ADR-001 decided)
- Did: ran a deep-research workflow surveying the FOSS document-templating
  landscape (Carbone, Typst, pdf-lib, and alternatives) to inform ADR-001.
  Workflow's final synthesis stage returned broken placeholder output
  (bug, feedback filed); manually re-derived the real findings from the
  run's journal (107 agents, 86 claims extracted, 25 adversarially
  verified, 17 confirmed/8 killed). No new FOSS option surfaced beyond
  what Stage 0 already evaluated. Key finding: Typst's pagination is
  renderer-side/automatic with a "regions" layout model giving exact
  positional info during layout (unlike TeX's decoupled
  linebreak-then-pagebreak) — the architectural crux of ADR-001.
  Maintainer decided ADR-001: **Option 2 (renderer-side/Typst), scoped by
  document type — not forced cross-renderer parity.** Typst owns
  pagination for multi-page/carry-forward/non-Latin documents;
  pdf-direct stays available for simple high-volume bursts on
  throughput grounds (12.1ms vs 100ms). Retires the original
  `test/conformance/` cross-renderer page-break-identity goal as a
  global guarantee — named as a deliberate trade-off, not hidden.
  Applied: ADRs/001-pagination-location.md Status → Accepted, Decision
  section written with reasoning + named risk (can't cheaply route one
  document type to either renderer interchangeably later without
  revisiting). ADRs/README.md status table updated; ADR-002 noted as
  inheriting the document-type-scoped-split framing. `npm run verify`
  green.
- Open: ADR-002 (volume renderer) still Proposed — now needs to decide
  the concrete document-type/locale routing rule between pdf-direct and
  Typst, per ADR-001's framing. GATE-BURST-WINDOW, GATE-S1-PREWORK still
  open. `spike/` deletion still blocked on Stage 0 exit gate (bursting
  window undecided).
- Next: either GATE-BURST-WINDOW (maintainer picks the bursting window)
  or start on ADR-002's routing rule — both are live paths forward now.

## 2026-08-26 — Stage 0 (loop tick 12, dispatcher: checkbox reconciliation)
- Did: dispatcher pass. INBOX Open empty, no gates newly answered — but
  flagged-last-session stale checkboxes were real. corpus-qa verified
  spike/RESULTS.md against ROADMAP.md:36/37/39: hardware re-run (line 36)
  and RTL/CJK smoke test (line 37) both have genuine target-hardware
  evidence already recorded (from loop Q2/Q3/Q5) — ticked both with
  inline citations. Bursting math (line 39) correctly stays unticked:
  GATE-BURST-WINDOW is genuinely still open, RESULTS.md has a
  parametrized 4-window table, not the single decided window the DoD
  names. arb-chair then ruled on a second flag: the Stage 0 exit gate
  (ROADMAP.md:45) said "all four decision drivers answered from
  measurements," but ADR-000 (now Accepted) has 5 drivers and only 1 is
  purely measurement-based. Updated exit-gate item 1 to match what was
  actually accepted (evidenced — measured, explicitly skipped, or
  ADR-sourced — not silently missing) without going toothless. Item 3
  (bursting window) left as-is — correctly still blocking. `npm run
  verify` green.
- Open: GATE-BURST-WINDOW, GATE-S1-PREWORK still open. ADR-001
  (pagination location) still needs deciding — live per ADR-000's
  practical consequence. `spike/` deletion (ROADMAP.md last task) still
  blocked on ADR-000/001 both being fully settled per the exit gate.
- Next: ADR-001 decision (maintainer), or the exit-gate re-check via
  `/gate-check 0` once bursting window is decided.

## 2026-08-26 — Stage 0 (ADR-000 decided)
- Did: maintainer decided ADR-000: **Option C (hybrid), scoped narrowly.**
  Clarified first (the draft's Option C text said "Carbone as renderer #1,
  fast to market," in tension with the skip-carbone decision) — confirmed
  the intent is: schema-first (Option A: Typst/pdf-direct) is the only
  renderer built now; Carbone/Path B is reserved behind the `Renderer`
  seam per Option C's architecture but not adopted, not built, not
  benchmarked — revisit only if a named user needs .odt/.docx authoring.
  Applied: ADRs/000-template-authoring-model.md Status → Accepted,
  Decision section rewritten from draft-recommendation to actual decision
  with the practical consequence spelled out. ADRs/README.md status table
  updated (000 Accepted; 001 now marked live/not-moot, since schema-first
  is the active path). ROADMAP.md:41 ticked with the decision summary.
  `npm run verify` green.
- Open: **ADR-001 (pagination location) is now live** — composition-side
  vs. renderer-side vs. hybrid, must be decided before Stage 1 locks
  contracts. ADR-002 (Typst vs. pdf-direct vs. both as volume renderer)
  also still open, informed by the RTL/CJK findings. Stage 0 exit gate
  (ROADMAP.md:44-48) not yet fully clear: line 45 says "all four decision
  drivers" but ADR-000 has 5 — pre-existing miscount in the roadmap text,
  not introduced this session, worth a small fix later. Bursting math and
  RTL/CJK ROADMAP checkboxes still look like stale duplicates of completed
  Q3/Q4 loop work (flagged last session, still not reconciled).
- Next: decide ADR-001 (pagination location) — present the three options
  (composition-side / renderer-side / hybrid) to the maintainer. Then
  Stage 0's remaining items: reconcile the stale RTL/CJK + bursting math
  checkboxes against actual Q3/Q4 evidence, re-run benches DoD note
  (ROADMAP.md:36 may also already be satisfied by loop tick 2/5 — same
  reconciliation), then `spike/` deletion + `/gate-check 0`.

## 2026-08-26 — Stage 0 (ROADMAP.md:40 ruling)
- Did: `/next` proposed getting an arb-chair ruling on whether
  ROADMAP.md:40 ("`/adr 000` round-table draft... decision drivers all
  evidenced") is satisfied by the ADR-000 draft, given drivers 2-4 are
  explicitly marked unanswered/unanswered-by-choice rather than measured.
  Ruling: **tick it** — "evidenced" ≠ "answered positively"; drivers 2-4
  are traceably documented as deliberately unanswered (cited to
  docs/INBOX.md, ROADMAP.md, ADRs/README.md), not fabricated or silently
  missing, which is what the DoD's document-completeness standard
  requires (no command can verify this DoD; two prior skeptic passes +
  this arb-chair review are the verification). ROADMAP.md:40 ticked with
  the ruling summary inline. No other ROADMAP.md text changes: line 41
  ([HUMAN] Decide ADR-000) stays unchecked, the Stage 0 exit gate (lines
  44-51) is unaffected and still fails criterion 1 until the maintainer
  actually decides ADR-000.
- Open: nothing from this task. Stage 0 exit gate still open (ADR-000
  undecided, hardware re-run and RTL/CJK-in-two-candidates and bursting
  math roadmap lines still unchecked — though RTL/CJK and bursting math
  were substantively done under the loop's Q3/Q4 work; those checkbox
  wordings may be stale duplicates of loop-queue items and worth a
  dispatcher pass to reconcile, not done here).
- Next: Stage 0's only remaining unblocked-in-principle roadmap lines are
  either [HUMAN]-only (hardware re-run, decide ADR-000) or look like
  stale restatements of already-completed loop work (RTL/CJK smoke test,
  bursting math — both done under Q3/Q4, see loop tick 3/4 entries below,
  but their ROADMAP.md checkboxes were never ticked). Worth reconciling
  those checkboxes against the loop's actual work next, or otherwise
  Stage 0 is human-blocked on ADR-000 itself.

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

- tick 15, 2026-08-27: noop — Stage 0 CLOSED this session (all 4 exit-gate criteria PASS, spike/ deleted). Queue empty, docs/INBOX.md Open section empty, not a dispatcher tick (15%4≠0). GATE-S1-PREWORK still open (default NO) — loop must not start Stage 1 tasks until answered.
- tick 14, 2026-08-27: noop — queue empty, docs/INBOX.md Open section empty, not a dispatcher tick (14%4≠0). ADR-000 and ADR-001 both Accepted this session (direct maintainer decisions, already reconciled into ROADMAP.md/ADRs/*, no dispatcher action needed). Remaining Stage 0 work: GATE-BURST-WINDOW (open), GATE-S1-PREWORK (open), spike/ deletion blocked on exit gate.
- tick 13, 2026-08-27: noop — queue empty, docs/INBOX.md Open section empty, not a dispatcher tick (13%4≠0). GATE-BURST-WINDOW and GATE-S1-PREWORK still open; ADR-001 (pagination location) still undecided — all human-blocked.
- tick 11, 2026-08-26: noop — queue empty (Q1-Q6 all done), docs/INBOX.md Open section empty, not a dispatcher tick (11%4≠0). Only remaining Stage 0 work is [HUMAN]-only (decide ADR-000/001) or a stale-checkbox reconciliation (RTL/CJK, bursting math ROADMAP lines vs. already-done Q3/Q4 — noted in the ROADMAP.md:40-ruling session entry) that's deferred to the next dispatcher pass (tick 12).
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
