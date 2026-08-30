# Proposal — Authoring assist: AI draft → adjust → export

**Status: Proposed 2026-08-29 — maintainer-drafted, chat-derived, grilled three
rounds by the maintainer; then put to an arb-chair roundtable the same day.
NOT an ADR-005 addendum. NOT ratified. Chat ≠ adoption.**

**Roundtable ruling (arb-chair, 2026-08-29) — read before the proposal:**
SPLIT. The AI *pipeline* half (start from sample/copy/blank → AI draft →
diff-oracle adjust with RFC 6902 patches → export + wire, accept as `draft`
with `provenance: ai-assisted`, redaction gate on uploads, bounded retries →
surrender) is in scope as a sharper spec of ROADMAP Stage 7 tracks 1 and 2,
trigger-gated and unchanged. The *projection editor* half (outline +
inspector + prompt on one screen, a separate setup screen, `npm run
builder`) is out of scope: it is the builder GAP-04 ratified as deleted, and
it violates docs/UI-DESIGN.md principle 5 ("a screen edits by conversation
OR by form, never both; source editing belongs to the user's own editor")
and the grilled workspace spec ("nothing else", 15 controls → 5). Filed here
as a proposal — not appended to ADR-005 — because an addendum to a Proposed
ADR with a numbered build order is a task list the autonomous loop would
read as authorisation. Nothing in this file is queued.

Claims that did not survive contact with the code (fix before ratification):
- "post-patch tree ajv-validates against the existing schema" — there is no
  JSON Schema for DocNode anywhere in `packages/`; `nodes.ts` is TS types
  only and `@busy-office/output-schema` is zero-runtime-dep, so ajv cannot
  live there. This post-condition needs a new, undeclared artifact.
- "Export + wire is byte-stable codegen writing `document-types/<type>.ts`"
  — those files are hand-authored TS (header comment, `readContract`,
  `templatesFor` map, `rulesFor`, `messageTemplates`); whole-file codegen
  clobbers them. Byte-stability needs a fenced region or a JSON sidecar,
  the latter changing the GAP-08 shape the proposal calls unchanged.
- "Schema unchanged except `provenance` at Stage 7 entry" — stale;
  `provenance: 'human'` is already on every meta today.
- OQ-A is not open: ROADMAP Stage 7 already names one trigger per track
  (≥3 real templates via the skill; previewer exists AND ≥5 external
  requests by name). Renderer-direct rendering must not quietly delete the
  "previewer exists" precondition. Track 1 stands at 0/3.
- OQ-B (persisted definition store) collides with four standing GAP-08
  "must not build" items (plugin/discovery, hot-reload, unregister,
  re-register), not merely "reopens GAP-08".
- Do not use the word "builder" for anything that ships (ROADMAP: "replaces
  the visual builder"; HLD §14; CLAUDE.md wall).

Ratification is conditioned on: (1) the editor half dropped or explicitly
re-argued against UI-DESIGN principle 5 + GAP-04; (2) triggers = the
existing two, unchanged; (3) the three code-contact claims reworded;
(4) "builder" removed from anything that ships. Decision: GAP-18 in
docs/GAP-REGISTER.md (human-only).

---

## The maintainer's draft, verbatim


## 1. What the builder is

A **DocNode projection editor**: a constrained tree editor over the nine
ratified DocNode kinds (`document, section, text, fieldGrid, table, totals,
header, footer, pageNumber` — `packages/schema/src/document/nodes.ts`),
whose output is the same artifact a developer writes by hand — a
`document-types/<type>.ts` definition. Not a canvas, not a freeform builder,
not a new authoring path. Both personas (developer-as-code, AI-assisted
adjuster) converge on one artifact; source of truth stays code.

Pipeline (maintainer's framing, amended R2c):
```
start from (template copy | blank | sample) + contract (data object)
  → AI draft (ADR-005 loop) → adjust (this editor) → export + wire
```

## 2. Inherited contract (ruled elsewhere — consumed, not amended)

- Palette = contract JSON Schema, ajv strict + `x-pii` (GAP-08 ruling).
- Edit vocabulary = the nine kinds. No tenth kind, no grammar change
  (GAP-08 ruling). Expressions validate against
  `docs/EXPRESSION-GRAMMAR.md` and resolve against the contract.
- Output = `{ meta: TemplateMeta, content: DocNode }` inside a
  `DocumentTypeDefinition` (GAP-08 ruling).
- ADR-005 non-negotiables hold verbatim: AI output is a template like any
  other (same corpus gates, overflow-must-fail); patches, not free-drawing;
  AI edits enter the lifecycle as `draft` and never touch `published`;
  template source only (never data, rules, delivery config); no payload
  egress — the loop runs on corpus fixtures or redacted input.
- `TemplateMeta.provenance` (`ai-generated` / `ai-assisted`) is ADR-005's
  own deliverable and the **only** schema touch anywhere in this design.
  It lands at Stage 7 entry, not before.

## 3. Amendments from the three grilling rounds

| # | Attack | Verdict |
|---|--------|---------|
| R1 | GAP-04 ratified this away; ADR-005 rejected product-first by name; design here repeats the GAP-13 build-past-the-gate pattern | **Survives as design-only.** This addendum opens with the no-build rule; the trigger condition becomes OQ-A (human-only). |
| R2a | Ruled `preview` requires `templateId`; registration has no unregister — unsaved drafts cannot preview through the port | **Amended.** Drafts render via the renderer library directly — the `diff.ts` precedent (renders LayoutIR JSON without the port). `port.preview` serves registered templates only. GAP-07 ruling untouched. |
| R2b | A bespoke patch-op vocabulary is a second grammar — inventory against the no-new-grammar spirit | **Amended.** RFC 6902 JSON Patch over the DocNode JSON. Zero new grammar; post-patch tree ajv-validates against the existing schema. Remaining design shrinks to a path **profile** (§5). |
| R2c | Skeletons are a new artifact class with no home, no owner, no versioning | **Killed.** "Skeleton" collapses to *start from: existing template (copy tree) \| blank (`document` node) \| sample (existing skill)*. No new artifact class ships. |
| R3 | "Register v1.0.0" is unimplementable in the flagship topology: registration is process-local, composition-root, no persistence — `serve()` operators cannot register anything at runtime | **Amended.** Primary CTA = **Export + wire** codegen (§6). Runtime register exists only in an embedded dev context. Files-first document-type store parked as OQ-B, explicitly outside GAP-08's current scope. |
| R3 | Builder inside the console breaks HLD's read-only console rule | **Amended.** Builder is a localhost dev surface (`npm run builder`), never mounted under `/output`. Console stays read-only. |
| R3 | Sample uploads carry real PII (payslips) | **Amended.** Redaction gate runs before the loop touches any upload, per ADR-005's existing Stage-4 redaction task. |

## 4. Amended design — the two screens

**Screen 1 — new template (setup).**
1. Data object: contract picker (from registered contracts); field list with
   types and `x-pii` badges; array fields show column counts.
2. Start from: three options — copy existing template / blank / from sample
   (upload → redaction gate → template-from-sample skill). *(Replaces the
   2×2 skeleton grid in the first wireframe.)*
3. AI draft: optional instruction text; runs the ADR-005
   generate → render → diff → repair loop headless; lands a draft tree.

**Screen 2 — adjust.**
- Header: `templateId@draft`, locale badge, renderer pin
  (`rendererId@version`, per GAP-15 the same value persisted at archive).
- Outline: the DocNode tree, nine kinds only; insert/reorder/remove.
- Inspector: per-node typed props; bindings edited against the expression
  grammar; schema-fixed props render locked (e.g. `table.repeatHeader:
  true`).
- Preview: **renderer-direct draft render** on the document type's corpus
  fixture. *(Caption changes from "port.preview" in the second wireframe;
  no registry row either way.)*
- Adjust-assist input: instruction → RFC 6902 patch → verifier loop (§5).
- Gate bar, always visible: overflow fail-closed (ADR-001), veraPDF
  PDF/A-2b, structural diff vs pre-edit baseline. Same validators as
  `npm run verify` — a template that fails gates cannot version.
- Exits: **Export + wire** (primary, §6) · Copy DocNode JSON · discard.

## 5. Adjust-assist mechanics (grounded in what exists)

1. **Context:** current DocNode tree, contract schema (+`x-pii`),
   expression grammar, selected node path, instruction. Never a real
   payload — fixtures only (`test/corpus/{invoice,payslip,purchase-order}`).
2. **Emission:** RFC 6902 patch. Static validation before any render:
   apply in memory → ajv against the DocNode schema → every expression
   parses and resolves against the contract. Validator message is the
   retry prompt.
3. **Patch profile (the one new design artifact):**
   - Allowed ops: `add, remove, replace, move, test`. `copy` excluded
     (duplicate-id hazard on templates).
   - Legal target paths: the `content` subtree only. `meta.version`,
     `meta.documentType`, and anything outside the template are illegal
     targets — enforced by profile check, not convention.
   - Post-conditions: patched tree ajv-valid; all bindings resolve;
     node-count delta bounded per instruction (blast-radius guard).
4. **Render both sides:** baseline and candidate on the same fixture,
   renderer-direct; `normalize-pdf` strips nondeterminism.
5. **Oracle:** `diffPdfBytes`/`formatStructuralDiff` (exit 0/1/2). Two-sided
   check: the diff must contain the instructed change (exit 0 = the edit
   did nothing = failure) and nothing else (collateral in untouched
   subtrees = reject). Patches make collateral mechanically detectable.
6. **Gates:** overflow (Typst build fails closed), veraPDF, corpus tests.
   Red gate → failing evidence is the next prompt; bounded retries (3);
   then surrender to the human with artifacts attached.
7. **Accept:** human reviews DocNode diff + structural report side by side.
   Accept = new `draft`, `provenance: ai-assisted`. Published versions
   immutable; goldens change only as a separate deliberate act.

## 6. Export + wire (primary exit)

Codegen, not runtime mutation:
- writes `packages/runtime/document-types/<type>.ts` (or the host
  project's equivalent path) exporting one `DocumentTypeDefinition`;
- emits the one-line composition-root registration
  (`registerDocumentType(...)`) as a ready-to-paste diff — never applied
  automatically;
- output is byte-stable given the same tree (deterministic codegen), so
  re-export of an unchanged template is a no-op diff.

The engine-boundary vitest lint (GAP-08 ruling) already polices the
result: `src/**` may not import `document-types/`. The builder writes
where a developer writes; nothing else moves.

## 7. Open questions (parked, human-only)

- **OQ-A — Stage-7 trigger condition.** Candidates surfaced in grilling:
  (a) a named non-maintainer template author appears (e.g. during informal
  operator contact — `GATE-S3-THESIS-CHECK`'s formal version was voided
  2026-08-30, docs/GAP-REGISTER.md GAP-13); (b) template count reaches the
  point where authoring cost measurably dominates a milestone; (c) a
  shadow-parity migration engagement (ADR-005's adoption funnel) is real.
  Owner: maintainer. Blocks: every build task below.
- **OQ-B — Files-first persisted document-type store** (the ADR-003
  pattern applied to definitions), enabling operator-side authoring in
  `serve()` without a rebuild. Explicitly outside GAP-08's ruled scope
  ("must not build: plugin/discovery, hot-reload"). Reopens GAP-08 if
  ever pursued; do not smuggle in via the builder.

## 8. Build order when OQ-A closes (not before)

- T-B0: patch profile + validate helper (apply → ajv → grammar/contract
  resolve). Pure functions, unit-tested. DoD: invalid-op and
  illegal-path fixtures all rejected pre-render.
- T-B1: adjust-assist as a Claude Code skill (headless), driving the
  existing render/normalize/diff scripts. DoD: round-trip on the corpus
  invoice — instruction applied, diff two-sided-clean, gates green.
  (Skill-first, per ADR-005's own sequencing.)
- T-B2: draft render service (renderer-direct) + setup screen.
- T-B3: adjust screen (outline, inspector, preview, gate bar).
- T-B4: Export + wire codegen; engine-boundary lint stays green.
- T-B5: sample-upload path with redaction gate, reusing
  template-from-sample.

## 9. Explicitly unchanged by this addendum

GAP-07 and GAP-08 rulings (verb surface, registration semantics,
"must not build" list) — untouched. GAP-04 persona — holds. ADR-009
milestone — holds. Console read-only rule — holds. Schema — untouched
except ADR-005's own `provenance` field at Stage 7 entry.

---
*Suggested SESSION-LOG entry on ratification:* "ADR-005 addendum ratified —
builder = DocNode projection editor; R1–R3 amendments recorded; OQ-A
(trigger) and OQ-B (persisted definitions) opened; no build scheduled."
