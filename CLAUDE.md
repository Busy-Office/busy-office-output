# Busy Office Output — Claude Code project memory

ERP document output runtime: **determination, rendering, archive, delivery,
audit**. An open-source alternative to commercial ERP output-management
stacks, renderer-agnostic.
Status: **Stages 0–5 closed** (Stage 4 exit gate met 2026-08-29: 8,000
per-recipient payslips in 18.63 min, 1.61x inside the window, 2 locales ×
2 channels, one audit row per resolution; ADR-002 Accepted. Stage 5
exit gate MET and stage CLOSED 2026-08-29 — ADR-007's two addenda
Accepted as drafted, GATE-S5-CLOSE/GATE-S5-RULINGS closed). **Stage 6
(Variant and locale depth) starting**, under the still-open
`GATE-S3-THESIS-CHECK` (gap register GAP-13) — its ratified exception is
read broadly, covering Stage 5's close and Stage 6's start, not just the
Stage-5 building that already happened. Every ADR through 009 is
Accepted except 005 (closes at Stage 7 entry). Two renderers:
`@busy-office/render-typst` (volume, all document types) and
`@busy-office/render-pdf-direct` (single-page/Latin/no-carry-forward, both
PDF/A-2b, veraPDF in the corpus gate). Document types are owner-supplied
via `registerDocumentType` (GAP-08) — the engine names none. Licence
Apache-2.0 (ADR-008). Human-only items open: GATE-S3-THESIS-CHECK (5-
operator demo), GAP-18 (authoring-assist proposal ratify/reject). Path B
(Carbone) stayed out of scope per ADR-000 throughout. One part-time
maintainer; sessions are short — leave everything in a resumable state.
`docs/GAP-REGISTER.md` is the live worklist alongside ROADMAP.md.

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
- **Standalone product, spine non-optional** (ADR-009, Accepted 2026-08-29;
  gap register GAP-01/GAP-02, ratified in chat). Primary objective is a
  standalone operator-facing product — `busy-office-erp-poc` is archived,
  not consumer #1; the embeddable module (`createOutput()`) stays real and
  tested as an architectural precaution, not the validation path. "Lean"
  means a small surface an operator/module sees, never a spine-optional
  engine: registry, archive, idempotency, and reprint semantics are
  non-optional, always present, regardless of consumer.
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
- PDF snapshots: zero CreationDate/ModDate, the trailer doc ID, **and XMP
  metadata** (`xmp:ModifyDate`, `xmpMM:InstanceID`/`DocumentID` — Typst
  embeds these even when the trailer fields are zeroed; found in Stage 2's
  Typst renderer, packages/render-typst/src/normalize-pdf.ts) before hashing
- External binaries are shelled out to, never reimplemented or npm-bound:
  `typst` (rendering), `pdftotext`/poppler-utils (structural diff),
  `verapdf` (PDF/A gate). Pinned in two places: the `Dockerfile`
  (2026-08-28, typst 0.15.1 for the container build) and
  `.github/ci/install-tools.sh` (2026-08-29, typst 0.15.1 + veraPDF 1.30.2
  + poppler-utils for CI, PATH-checked before `npm run verify`). CI is
  green on the real runner as of commit 8c9fa64 (GAP-12 closed) — "in CI"
  compliance claims are now actually true.
- **Pre-authorized system installs**: Claude may run `brew install <tool>`
  without asking first when — and only when — ALL of these hold: (1) the
  tool is a local dev-machine binary this project shells out to (matches
  the pattern above — `typst`, `verapdf`, `pdftotext`/poppler-utils, and
  any future tool logged the same way), never a language runtime swap,
  package-manager change, or anything touching system security/network
  config; (2) it's already named in an open `GATE-*-INSTALL` entry in
  `docs/HUMAN-GATES-LOG.md`, or is being added as a new one in the same
  session (log it either way — this doesn't skip the gate-log paper
  trail, it only skips the *ask*); (3) the install is a plain `brew
  install`/`brew upgrade`, nothing scripted from an untrusted URL. Log the
  install (what, when, `brew` output) in the gate entry same as before.
  Anything outside these bounds (a different package manager, sudo, a
  non-dev-tool, anything that could affect other software on the machine)
  still asks first.

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
