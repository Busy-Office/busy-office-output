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
state: docs/loop-state.json
verify: npm run verify
session_log: docs/SESSION-LOG.md
dispatch_every: 4
stop_on_gate: false
```

## Every tick
1. Read `docs/loop-state.json`; increment `tick`; write it back first.
   (Moved out of `.claude/` 2026-08-30: that directory is under Claude
   Code's built-in sensitive-file protection, which cannot be
   pre-approved via a cloud routine's `allowed_tools` — an unattended
   cloud tick would hang forever on a permission prompt nobody can
   answer. `docs/loop-state.json` is an ordinary tracked file.)
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
   complete — Q-items may be partial), commit (`stage0: <what>`) and `git push origin main` (authorized by maintainer 2026-08-26; never force).
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
   items to **Processed** with disposition. Commit `docs: dispatch tick N` and push.
5. Reset `consecutiveNoopDispatches = 0`, set `lastDispatchTick`.

## Hard stops (never do)
- Install system software (brew/apt) — log a gate instead. This applies
  in the cloud environment too: even though a cloud tick's container is
  disposable, don't shell out to a package manager there either — log
  `GATE-CLOUD-VERIFY-ENV` (see below) instead.
- `rm` under `spike/`, close/decide any ADR, create a `packages/*` dir.
- Log payload data; only hashes/traces.
- Tick a ROADMAP checkbox whose DoD command did not run this tick.
- Self-answer a gate.

## Cloud environment (hourly routine)
The cloud sandbox has no `typst`/`verapdf`/`pdftotext` on PATH (unlike a
brew-provisioned Mac or the CI runner's `install-tools.sh`), so
`npm run verify` cannot be fully green there — corpus/renderer-dependent
tests fail with `spawn typst ENOENT`-shaped errors regardless of what
changed. Do not try to install them (hard stop, above). Instead: before
trusting a verify failure, `git stash` your change and re-run the same
failing suite against the unmodified tree; if the exact same files fail
both ways, they're this environment's pre-existing gap, not something
your change broke — proceed. If your change touches renderer/corpus code
in a way you cannot verify this way (no clean baseline to diff against,
or the DoD itself requires a real render), don't tick that task's
checkbox from a cloud tick — log it as blocked-by-environment and pick a
different queue item instead. Log `GATE-CLOUD-VERIFY-ENV` in
`docs/HUMAN-GATES-LOG.md` (once, not every tick) so this is a tracked,
visible constraint rather than a silent workaround repeated forever.

## Orchestration (ultracode is ON for this project — maintainer, 2026-08-26)
Each non-trivial tick runs as a Workflow, sequential and gated:
1. `build` — the queue row's agent implements the task (worktree isolation not
   needed: one tick, one task).
2. `verify` — 2 independent skeptics try to REFUTE the DoD evidence (did the
   command actually run? is the RESULTS.md number from this machine? was any
   checkbox ticked without its gate?). Either refutation → back to build, max 3.
3. `close` — `npm run verify`, SESSION-LOG entry, commit, push.
Dispatcher ticks add a `rule` stage: arb-chair proposes ROADMAP edits, a
skeptic checks them against the Deferred wall and CLAUDE.md golden rules
before they are applied. Noop ticks spawn nothing.
