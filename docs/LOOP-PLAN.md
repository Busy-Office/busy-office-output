# Autonomous loop plan (20-min ticks, dispatcher every 4th tick)

Written 2026-08-26 after reviewing ROADMAP.md + docs/HLD.md. Operational
rules live in `.claude/skills/build-loop/SKILL.md` (project override); this
file is the rationale and the work queue.

## Where the project stands
- Stage 0 (kill gate) is open. 3/11 tasks done. 6 of the 8 remaining are
  **[HUMAN]** (LibreOffice + `.odt` authoring, CCL licence read, ADR-000
  decision, spike deletion after decision).
- This machine has never run the repo: no `node_modules`, no
  `typst`, no LibreOffice, no veraPDF. It *is* the target hardware.
- Tool-less Claude-doable Stage 0 work is small and finite (queue below).
  After it is exhausted the loop is **human-blocked by design** — that is
  the kill gate working, not a loop failure.

## Loop shape
```
/loop 20m /build-loop --tick        # start (user-invoked)
```
Each tick = one session per CLAUDE.md protocol: orient → one task → verify →
log. Tick counter in `docs/loop-state.json`. On `tick % 4 == 0` the
**dispatcher** runs first (see SKILL.md §Dispatcher): reads `docs/INBOX.md`,
gate answers, RESULTS.md changes; `arb-chair` rules on roadmap edits; the
roadmap is updated *before* any build work. Checkboxes are only ticked when
the DoD command ran this tick. Human sign-offs go to
`docs/HUMAN-GATES-LOG.md`; the loop never waits on them.

## Work queue (Stage 0, Claude-doable, in order)
| # | Task | DoD (witnessed) | Agent |
|---|---|---|---|
| Q1 | Bootstrap: `npm install` root + `spike/pdf-direct` (git + remote `Busy-Office/busy-office-output` already set up, baseline pushed) | `npm run verify` green; `npm run spike:data` twice → identical hash | corpus-qa |
| Q2 | pdf-direct bench on this Mac → RESULTS.md hardware section + gate-5 row (pdf-direct column) | `npm run spike:pdf-direct` prints p50; RESULTS row filled with machine/Node | render-engineer |
| Q3 | RTL/CJK smoke (th-TH, ja-JP, ar-SA) in pdf-direct using macOS system fonts (Thonburi, Hiragino, Geeza Pro) | RESULTS.md RTL/CJK section pass/fail per script, rasterized page checked | render-engineer |
| Q4 | Bursting math, parametrized (window unknown → table for 15/30/60 min) | RESULTS.md bursting section; GATE for the human to pick the window | corpus-qa |
| Q5 | Typst on this Mac — **needs `brew install typst`** (GATE-TYPST-INSTALL; loop does not install system software) | after install: `npm run spike:typst` p50 warm + RTL/CJK column | render-engineer |
| Q6 | `/adr 000` draft — only once carbone row filled **or** INBOX says carbone is skipped | draft appended to ADR-000 with every decision driver cited to RESULTS | arb-chair |
| — | Then human-blocked: carbone, CCL, ADR-000 decision, spike delete | | |

## What the loop must NOT do (from CLAUDE.md, restated for the loop)
- Start Stage 1 while Stage 0 is open, **unless** the human answers
  GATE-S1-PREWORK in INBOX.md allowing the four path-independent Stage 1
  tasks (contracts, variant resolver, reproduction policy, Tier-1 codes).
  Default: no — Stage 0 is a kill gate; product code before it is waste.
- Install system software, delete `spike/`, close any ADR, or add a package dir.
- Tick a checkbox without running its DoD command in that tick.

## Expected timeline
Ticks 1–4 (≈80 min) clear Q1–Q4 and run the first dispatch. Tick 5+ are
dispatcher/noop ticks until the human feeds INBOX.md (typst install, window,
carbone status, S1-prework answer). Stop the loop when it has noop'd 3
dispatches in a row — nothing will change without human input.
