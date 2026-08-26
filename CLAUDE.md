# Busy Office Output — Claude Code project memory

ERP document output runtime: **determination, rendering, archive, delivery,
audit**. The open-source equivalent of SAP NAST/BRF+, renderer-agnostic.
Status: **Stage 0** (see ROADMAP.md). One part-time maintainer; sessions are
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
- **ADR-000 is open.** Until a human closes it, do not delete `nodes.ts`/
  `layout-ir.ts` (Path A drafts) and do not build Path-A composition beyond the
  spike. Claude may *draft* ADR recommendations from `spike/RESULTS.md`
  evidence; only the human decides.
- **Gates are commands, not opinions.** A stage task is done when its gate
  command passes. Never mark a ROADMAP checkbox without running the check.
- **No package before its stage.** `packages/` gains a directory only when the
  roadmap stage that owns it begins. No empty placeholders.
- **Deferred table is a wall.** Labels, Peppol, signatures, Excel, ERP adapters,
  builder: do not scaffold, stub, or "prepare for" them.
- `@busy-office/output-schema` stays **zero-runtime-dependency**.
- Templates are never copied — variant resolution + `parentId` inheritance only.
- Never log data-contract payloads (payslips = PII). Hashes and rule traces only.
- Delivery failure never triggers re-render. The archived artifact is the reproduction.
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
npm run spike:data        # regenerate deterministic reference PO (seeded)
npm run spike:pdf-direct  # verified renderer, prints ms/doc
npm run spike:typst       # needs typst binary on PATH
npm run spike:carbone     # needs LibreOffice + authored po-template.odt
```

## Conventions
- TypeScript strict, NodeNext modules, Node >= 22 (`.nvmrc`)
- Money is integer-cents or round-at-boundary; formatting is the renderer's job
- Commit style: `stage0: <what>` / `adr: <what>` / `docs: <what>`
- PDF snapshots: zero CreationDate/ModDate and doc ID before hashing
  (see `spike/pdf-direct/run.js` for the pattern)

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
