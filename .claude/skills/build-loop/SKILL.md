---
name: build-loop
description: Project override of /build-loop for busy-office-output. One ROADMAP task per tick, dispatcher every 4th tick, human gates never block. Invoked by `/loop 20m /build-loop --tick`.
---

# /build-loop — busy-office-output override

Replaces the global build-loop steps. No `busyoffice emit`, no DESIGN-GRAPH,
no Supabase rules. The milestone source is `ROADMAP.md`; the design record
is `ADRs/` + `docs/HLD.md`; CLAUDE.md golden rules apply verbatim.

## Config
```yaml
milestone_source: ROADMAP.md
work_queue: docs/LOOP-PLAN.md          # ordered Claude-doable queue Q1..Qn
gate_log: docs/HUMAN-GATES-LOG.md
inbox: docs/INBOX.md
state: .claude/loop-state.json
verify: npm run verify
session_log: docs/SESSION-LOG.md
dispatch_every: 4
stop_on_gate: false
```

## Every tick
1. Read `.claude/loop-state.json`; increment `tick`; write it back first.
2. If `tick % dispatchEvery == 0` → run **Dispatcher** (below) before anything else.
3. Orient: ROADMAP.md current stage, SESSION-LOG top entry, ADRs/README.md.
4. Pick ONE task: first item of `queue` in loop-state whose prerequisites hold
   (LOOP-PLAN table). Never a **[HUMAN]** task; never past the current stage
   unless GATE-S1-PREWORK is answered yes in INBOX.
   If nothing is runnable → noop tick: append one line under a
   `## Loop ticks` heading in SESSION-LOG (`- tick N noop: blocked on GATE-…`), stop.
5. Delegate to the agent named in the queue row (render-engineer / corpus-qa /
   arb-chair / runtime-engineer). Spike work stays under `spike/`.
6. Verify: run the task's DoD command **and** `npm run verify`. Only then move
   the item to `done`, tick the ROADMAP checkbox (if the whole roadmap task is
   complete — Q-items may be partial), commit (`stage0: <what>`).
   3 failed fix cycles → log GATE-<Q>-REGRESSION, move on.
7. Log: SESSION-LOG entry per the template (Did / Open / Next) or the one-line
   noop form. Leave the tree resumable.

## Dispatcher (tick % 4 == 0)
1. Read INBOX.md **Open**, HUMAN-GATES-LOG rows with status open, and diff
   RESULTS.md / ROADMAP.md against the last dispatch (git log since
   `lastDispatchTick` commit).
2. If nothing new → `consecutiveNoopDispatches++`; write state; if it reaches
   3, write `- dispatcher: 3 quiet dispatches — recommend stopping /loop` to
   SESSION-LOG and the terminal; continue to the normal tick.
3. Else spawn `arb-chair` with the new input + ROADMAP.md + LOOP-PLAN.md:
   "For each input: does it add/modify/remove a roadmap task, answer a gate,
   change the queue order, or is it out of scope (Deferred wall)? Return
   exact ROADMAP edits (task text + DoD), gate status changes, queue changes."
4. Apply the ruling: edit ROADMAP.md (tasks/DoD only — never tick a box here),
   update HUMAN-GATES-LOG status, update `queue` in loop-state, move INBOX
   items to **Processed** with disposition. Commit `docs: dispatch tick N`.
5. Reset `consecutiveNoopDispatches = 0`, set `lastDispatchTick`.

## Hard stops (never do)
- Install system software (brew/apt) — log a gate instead.
- `rm` under `spike/`, close/decide any ADR, create a `packages/*` dir.
- Log payload data; only hashes/traces.
- Tick a ROADMAP checkbox whose DoD command did not run this tick.
- Self-answer a gate.
