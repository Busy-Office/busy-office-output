# Busy Office Output — Claude Code project memory

ERP document output runtime: **determination, rendering, archive, delivery,
audit**. An open-source alternative to commercial ERP output-management
stacks, renderer-agnostic.
Status: **Stage 0 and Stage 1 both closed 2026-08-27** (exit gates passed,
see ROADMAP.md); Stage 2 not yet started. Path B (Carbone) Stage 1 task
stayed out of scope per ADR-000. One part-time maintainer; sessions are
short — leave everything in a resumable state.

## Read order at session start
1. `ROADMAP.md` — find the current stage and its first unchecked task
2. `docs/SESSION-LOG.md` — what the last session did and left open
3. `ADRs/README.md` — which decisions are open; **no stage closes with its ADRs open**

Design records (consult, don't re-derive): `docs/HLD.md` (architecture),
`docs/UI-DESIGN.md` (console: five principles, 11 screens, absent-list),
`docs/STANDARDS.md` (compliance tiers).

## Golden rules (violating these is a failed session)
- **The runtime is the product.** Rendering is buy-or-thin-wrap; Stages 3–5 are
  where effort goes. Never gold-plate a renderer.
- **ADR-000 and ADR-001 are Accepted** (2026-08-27; Option C hybrid,
  schema-first built now — see `ADRs/000-template-authoring-model.md`,
  `ADRs/001-pagination-location.md`). Stage 1 is open (`GATE-S1-PREWORK`
  closed 2026-08-27). Path B (Carbone) stays out of scope per ADR-000's own
  "do not build both speculatively" clause — the Stage 1 Path-B task is
  marked N/A in ROADMAP.md, not built. Claude may *draft* ADR
  recommendations from evidence (now in `docs/RESULTS.md`); only the human
  decides.
- **Gates are commands, not opinions.** A stage task is done when its gate
  command passes. Never mark a ROADMAP checkbox without running the check.
- **No package before its stage.** `packages/` gains a directory only when the
  roadmap stage that owns it begins. No empty placeholders.
- **Deferred table is a wall.** Labels, Peppol, signatures, Excel, ERP adapters,
  builder: do not scaffold, stub, or "prepare for" them.
- `@busy-office/output-schema` stays **zero-runtime-dependency**.
- Templates are never copied — variant resolution + `parentId` inheritance only.
- Never log data-contract payloads (payslips = PII). Hashes and rule traces only.
- Delivery failure never triggers re-render. The archived artifact is the
  reproduction — full policy in `docs/POLICY.md`.
- **Console screens obey the five UI principles** in docs/UI-DESIGN.md; the
  deliberately-absent list is binding — adding to it needs an arb-chair ruling.
- **Standards by tier** (ADR-006, `docs/STANDARDS.md`): Tier 1 codes live in the
  contracts; archived artifacts are PDF/A-2b; **no compliance claim without a
  validator passing in CI** (veraPDF, Schematron, schema validation).
- **AI-generated or AI-patched templates are still templates** (ADR-005): same
  corpus gates, provenance recorded, edits enter the lifecycle as `draft`.
  The verifier is the corpus diff — no verifier, no generation.

## Commands
```bash
npm run verify            # typecheck + tests — must pass before every session close
npm run typecheck         # strict tsc over packages/schema
```
`spike:*` commands are gone — `spike/` was deleted 2026-08-27 when Stage 0
closed its exit gate; see `docs/RESULTS.md` for what they found.

## Conventions
- TypeScript strict, NodeNext modules, Node >= 22 (`.nvmrc`)
- Money is integer-cents or round-at-boundary; formatting is the renderer's job
- Commit style: `stage0: <what>` / `stage1: <what>` / `adr: <what>` / `docs: <what>`
- PDF snapshots: zero CreationDate/ModDate and doc ID before hashing
  (pattern preserved in git history; see `docs/RESULTS.md` for the
  measurements it produced)

## Session protocol
1. **Start:** read the three files above; state the one task you will do.
2. **Work:** one ROADMAP checklist item per session unless trivially small.
   Use subagents: `arb-chair` before any design/scope call, `render-engineer`
   for spike/renderer work, `runtime-engineer` for Stages 3–5, `corpus-qa`
   for tests/gates, `console-designer` for any console screen or control.
3. **Close:** run `npm run verify`; update ROADMAP checkboxes you actually
   completed; append a `docs/SESSION-LOG.md` entry (template inside); state
   what the next session should pick up.

## Slash commands
`/next` — propose the single next task with its definition of done
`/gate-check <stage>` — run that stage's gate commands, report pass/fail
`/adr <n>` — summarize an ADR and draft (not decide) a recommendation from evidence
`/session-close` — verify, update logs and checkboxes, summarize
