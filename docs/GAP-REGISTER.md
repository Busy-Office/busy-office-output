# Gap register — busy-office-output

Chat-derived 2026-08-29 by the maintainer; ratified item-by-item in chat the
same day. **Chat ≠ adoption**: a gap is closed only when its named close
condition is met — an ADR status, a command, or an artifact.

**Types:** DECISION (human ratifies) · SEAM (structural design + build) ·
TASK (Claude-doable now) · GATE (external validation) · HYGIENE (doc truth).

## Decisions

### GAP-01 — Primary objective — **RATIFIED 2026-08-29**
- Type: DECISION
- Was: standalone product vs ERP subsystem, held ambiguously by ADR-007.
- Decision: **standalone product.** `busy-office-erp-poc` is archived, not
  consumer #1. Next milestone is the operator demo (`GATE-S3-THESIS-CHECK`),
  not "first module wired through the API."
- Closed by: `ADRs/009-primary-objective.md` (Accepted).

### GAP-02 — Spine scope — **RATIFIED 2026-08-29**
- Type: DECISION
- Was: is the audit core (registry/archive/idempotency/reprint) optional?
- Decision: **non-optional.** "Lean" = the surface an operator/module sees,
  never a spine-optional engine.
- Closed by: CLAUDE.md golden rule "Standalone product, spine non-optional."

### GAP-03 — ADR-002 stale: volume renderer decided on dead numbers — **CLOSED 2026-08-29**
- Type: DECISION
- Decision (maintainer, in chat): ADR-002 Accepted — Typst-only clears
  the window (18.64 min, 1.61x, measured); pdf-direct kept as a scheduled
  Stage 4 task gated on PDF/A-2b (embedded TTF + XMP + OutputIntent,
  veraPDF-clean), not dropped. Stage 4 exit gate's "ADR-002 closed"
  condition met.
- Measurement record (the evidence it was decided on):
- The Claude half is closed: 8,000 payslips run to completion through
  the real pipeline (validate+determine+mint+render+archive+enqueue),
  Typst-only, single-process — **18.64 min, 139.8 ms/doc, 1.61x inside
  the 30-min window, measured not projected**. Concurrency-4 extrapolated
  from N=2,000: 6.5 min (4.62x). Render is 99% of per-doc cost. Drain
  adds 44.6 s. Full section: `docs/RESULTS.md` §Bursting — real pipeline.
  Supersedes the Stage-0 container/single-render projections ADR-002 was
  drafted on.
- Still closes when: ADR-002 Accepted on that measurement. The measurement
  clears the window with margin Typst-only, with no second renderer — the
  "Typst-only, pdf-direct reserved-not-adopted" outcome (the ADR-000
  Carbone pattern) is now evidenced, not assumed. Human decides.
- Owner: human. Blocks: Stage 4 exit gate.

### GAP-04 — Template authoring persona — **RATIFIED 2026-08-29**
- Type: DECISION
- Was: ADR-000 driver 2 left traceably unanswered.
- Decision: **implementing developer authors templates as code** (DocNode
  trees, as every shipped template was). AI-loop is Stage 7, trigger-gated,
  optional, never the primary persona. Visual builder stays deleted.
- Closed by: `ADRs/000-template-authoring-model.md` addendum 2026-08-29.

### GAP-05 — Licence: public repo, no LICENSE (ADR-008) — **CLOSED 2026-08-29**
- Type: DECISION
- Decided (maintainer, in chat, on a maintainer-authored ADR-008 draft):
  **Apache-2.0**, copyright holder Busy Office. Explicit patent grant
  fits the enterprise back-office audience; DCO-gated contributions keep
  future dual-licensing legally clean; "stay unlicensed" was strictly
  dominated (closes every present door, preserves no future option).
- Closed: `LICENSE` (canonical Apache-2.0 text), `NOTICE`,
  `CONTRIBUTING.md` (DCO required on every commit), SPDX
  `"license": "Apache-2.0"` in root + all four package.json files, README
  "evaluation only" paragraph replaced. Follow-ups not in this repo's
  scope: npm trusted publishing (needs the maintainer's OIDC setup), the
  erp-graph edge flip (lives in busy-office-erp).

### GAP-06 — Print scope vs the Deferred wall — **CLOSED 2026-08-29**
- Type: DECISION
- Ratified (maintainer, in chat): **"PDF is the print path."** No print
  agent enters scope; the archived PDF/A-2b artifact is what gets printed,
  via the operator's own OS/print infrastructure. No site named; the
  Deferred wall entry stands as-is.

### GAP-18 — Authoring-assist proposal: ratify or reject (the split)
- Type: DECISION — **OPEN, human-only** (proposal drafted by the
  maintainer 2026-08-29; roundtable-ruled the same day)
- The maintainer's "DocNode projection editor" draft is filed verbatim at
  `docs/proposals/authoring-assist.md` with the roundtable ruling as its
  header. NOT an ADR-005 addendum; nothing queued.
- Roundtable verdict: **SPLIT.** The AI pipeline half (sample/copy/blank
  → AI draft → RFC 6902 patch adjust with a diff oracle → export, accept
  as `draft`/`ai-assisted`, redaction gate, bounded retries) is in scope
  as a sharper spec of Stage 7 tracks 1+2, trigger-gated, unchanged. The
  projection-editor half (outline + inspector + prompt, a setup screen,
  `npm run builder`) is out of scope — it is the builder GAP-04 ratified
  as deleted, and violates UI-DESIGN principle 5 (conversation OR form,
  never both; source editing stays in the user's editor).
- Sub-items ruled by the chair (recorded so they aren't reopened): OQ-A
  (Stage-7 trigger) is NOT open — ROADMAP already names one trigger per
  track; track 1 stands at 0/3. OQ-B (persisted definition store) is out
  of scope — collides with four GAP-08 "must not build" items.
- Three claims did not survive the code (no DocNode JSON Schema exists;
  codegen would clobber hand-authored document-types/*.ts; `provenance`
  already exists) — listed in the proposal header.
- Closes when: the maintainer ratifies WITH the split (then: Stage 7
  tracks 1+2 gain "spec: docs/proposals/authoring-assist.md", UI-DESIGN's
  absent-list gains "no tree/outline/inspector editor (GAP-04)", HLD §12
  notes the developer authoring surface is not a console screen) — or
  rejects it (file stays as history). Either way, no build until a Stage
  7 trigger fires. The loop changes nothing in its queue on this gap.

## Seams

### GAP-07 — Consumer contract: five verbs, two exist — **CLOSED 2026-08-29**
- Type: SEAM — closed by commit 3978a77; corpus-qa re-derived all 10
  checks PASS (live serve() round-trip, reproduce stub proven to touch
  neither registry nor authz, status projection proven PII-free). ADR-007
  addendum recording the v1 surface is PROPOSED — the maintainer's
  ratification is a separate act the close does not depend on.
- Ruling that was the builder's contract (retained for the record):
- Ruling summary (full text in the arb-chair transcript; this is the
  builder's contract):
  - **All five verbs typed now.** `emit` (rename of submitEvent, no alias —
    no external consumer exists), `preview` (render only: no registry row,
    archive, delivery, trace, or docId; requires `templateId`, does NOT run
    determination), `status(BusinessEventKey) → DocumentStatus[]` (a
    projection that deliberately EXCLUDES ownerId — PII; needs one new
    `RegistryStore.listByEventKey`, no migration), `reproduce` (Stage 5 —
    an honest typed stub whose ONLY v1 return is
    `{ status: 'not-implemented', availableFrom: 'stage-5' }`; no throw, no
    authz call inside the stub), `registerDocumentType` (verb 5 = GAP-08).
    `resumeStrandedCompositions` stays as an operational method.
  - Consumer round-trip = `serve()`: `handleEvent` becomes a thin transport
    over `port.emit`; new `POST /render` → `preview`; new
    `GET /documents?businessObject=…` → `status`. Contract tests in
    `output-port.contract.test.ts`.
  - **Must not build:** `reproduce` body, a `preview` that runs
    determination, npm publishing, the ADR-007 package-map split (deferral
    holds — no external consumer even exists), plugin/discovery, hot-reload.
  - Record the v1 surface as an ADR-007 addendum (Proposed, maintainer
    ratifies).
- `emit` exists (OutputPort); `preview` named in HLD §4, never built;
  `status(businessKey)` missing; `reproduce(docId, channel)` has an
  AuthorizationPort but no callable operation (Stage 5);
  `registerDocumentType` missing entirely (→ GAP-08).
- Closes when: OutputPort v1 typed with all five verbs + contract tests;
  one consumer round-trips them.
- Note: with GAP-01 = standalone product, "one consumer" for the
  round-trip is this project's own `serve()`/console path, not an external
  ERP module.

### GAP-08 — Registration inversion: engine owns the document types — **CLOSED 2026-08-29**
- Type: SEAM — closed by commit 3978a77 (with GAP-07). The gap's wording
  was the hardcoded template map: deleted; built-ins moved to
  packages/runtime/document-types/; sample-memo registers from outside
  the tree; the vitest boundary lint is proven to bite. Residual per-type
  switches OUTSIDE the gap's wording are logged separately as GAP-17.
- Ruling that was the builder's contract (retained for the record):
- Ruling summary (builder's contract):
  - `registerDocumentType(definition: DocumentTypeDefinition)` — synchronous,
    process-local, in-order, no unregister. `DocumentTypeDefinition =
    { documentType, contract (JSON Schema object; engine compiles it — ajv
    strict + x-pii keyword), templates: {meta: TemplateMeta, content:
    DocNode}[], rules: OutputRule[] }`. Result: registered | duplicate |
    invalid (contract fails to compile, duplicate template id, rule
    documentType ≠ definition's). Lives in RUNTIME
    (`src/registration/document-type-definition.ts`), not schema — it
    composes only existing types, and OutputRule lives in runtime. Zero
    schema change; no tenth DocNode kind; no grammar change.
  - **Built-ins move to `packages/runtime/document-types/`** (sibling of
    `rules/`, OUTSIDE `src/`), not a new package — "no package before its
    stage" and the ADR-007-split deferral both forbid a package, but
    leaving them in-tree fails the gap's own wording: the hardcoded map in
    `template-content.ts` IS the gap, and a file move is the minimum that
    deletes it. Contract JSON stays in `packages/schema/contracts/` (moving
    it touches RENAME-POLICY for no gain); each `document-types/<type>.ts`
    reads it and exports one definition. `src/index.ts` (the composition
    root) registers all three through the port — the built-ins themselves
    round-trip verb 5. A synthetic `test/document-types/sample-memo/`
    proves registration from outside the engine tree.
  - Engine deletions: `src/render/template-content.ts` (gone),
    `KNOWN_DOCUMENT_TYPES`/`DocumentType` union (→ `string`), hardcoded
    validators, `load-rules.ts`'s default path + module cache
    (registration IS the cache), `CreateOutputDeps.rules`/
    `templateCandidates` overrides (tests register a type instead).
  - **Lint = a vitest test**, not ESLint/dependency-cruiser (repo has no
    ESLint; a toolchain for one rule is gold-plating):
    `src/registration/engine-boundary.test.ts` walks `src/**/*.ts`
    (excluding tests and `src/index.ts`), fails on any import of
    `document-types/`, `rules/`, `contracts/`, or the schema contracts
    path; also asserts `template-content.ts` no longer exists. Runs inside
    `npm run verify`.
- Contracts, rules, and template content live inside the engine tree
  (`packages/schema/contracts/`, `packages/runtime/rules/`, hardcoded
  lookup in `render/template-content.ts`). No registration seam exists.
- Closes when: `registerDocumentType(contract, templates, rules)` seam
  exists and one document type registers from outside the engine tree,
  lint-enforced.
- Blocks: GAP-07 verb five.

### GAP-09 — Embedded topology leaks the typst binary into hosts — **CLOSED 2026-08-29**
- Type: SEAM
- Ratified (maintainer, in chat): **T2 split worker is the default for any
  future embedding host** — host embeds the thin API only, rendering runs
  in a separate worker that owns the binary. Recorded as an ADR-007
  addendum. Nothing built (no active host under ADR-009).

### GAP-10 — Email is bytes-only: no message body templating — **CLOSED 2026-08-29**
- Type: SEAM — built 1b7d4b5; corpus-qa re-derived all 10 checks PASS with
  mutation testing: the no-value-outside-expressions clause is enforced
  twice (byte-for-byte reconstruction from the registered template AND a
  payload-needle sweep), proven by a renderer-side leak failing both. The
  check also noted the prescribed template-side mutation cannot exercise
  the sweep (an expr added to the template is by definition allowed) — a
  per-type expression ALLOWLIST would be a new policy, not a gap here.
- Original decision:
- Governance decision (maintainer, in chat): **template — lifecycle-
  governed.** Email subject/body are templates resolved per document type
  + locale via the same variant resolution, entering the same
  draft→review→published lifecycle as document templates, corpus-gated,
  provenance recorded. Not channel config. Rationale: a payslip body that
  names an employee is PII-adjacent content and belongs under the same
  discipline as the payslip itself; consistent with "templates are never
  copied" and "the runtime is the product."
- Build task now on ROADMAP with its DoD. Sequenced after Stage 4 clause 2
  (touches the same delivery/determination seams).

## Tasks

### GAP-11 — serve() still mints pre-outbox (T3 crash gap) — **CLOSED 2026-08-29**
- Type: TASK
- Was: `server.ts` used the pre-outbox mint; a crash mid-composition in
  the primary demo topology stranded rows invisible to
  `resumeStrandedCompositions`. Also: `serve()` never called
  `resumeStrandedCompositions` at all, so even embed-path strandings were
  recoverable-in-principle but never actually recovered.
- Closed: all three conditions met. Shared `submit-resolution.ts` used by
  both call sites; `serve()` runs a startup resume sweep;
  `serve-crash-resume.test.ts` green with red/green proof; ROADMAP ticked.

### GAP-12 — CI violates "no claim without a validator in CI" — **CLOSED 2026-08-29**
- Type: TASK
- Was: ci.yml ran the deleted spike/ step (red since 2026-08-27) and
  installed no typst/verapdf/poppler — every "in CI" compliance claim
  was local-only.
- Closed: commit 8c9fa64, GitHub Actions run 33229511242
  conclusion=success on the real runner (the two preceding commits
  failed under the old workflow — genuine red-to-green). typst 0.15.1 +
  veraPDF 1.30.2 + poppler-utils pinned, PATH-checked, `npm ci` +
  `npm run verify` passing there.

### GAP-15 — rendererVersion never written to the registry — **CLOSED 2026-08-29**
- Type: TASK (surfaced 2026-08-29 by the pdf-direct build)
- Closed: commit bf076c7. Combined `id@version` in the existing
  `renderer_version` column (no migration); written in the same UPDATE as
  archiveRef; empty renderer rejected before any bytes are written. e2e
  asserts typst@0.15.1 vs pdf-direct@1.17.1 differ (derived from real
  `Renderer.version`); console shows the value on archived rows, "—" on
  DRAFT rows. 264/264.
- Original finding:
- `DocumentRegistryRow.rendererVersion` exists (HLD §3 lists
  "template+renderer versions" as part of the audit row) but
  `archiveArtifact()` never writes it — the console renders "—" on every
  row. Tolerable with one renderer; with two (Typst 0.15.1, pdf-direct
  = pdf-lib 1.17.1) the audit row can no longer say which renderer
  produced the archived bytes, which is exactly what "the archive is the
  reproduction" needs to be defensible. `Renderer.version` is already on
  the port; the value is available at archive time.
- Closes when: `archiveArtifact` (or the composition step) persists
  `rendererId@version` on the row; a test asserts a pdf-direct-rendered
  row and a Typst-rendered row carry different, correct values; the
  console's `template@ver · renderer@ver` line stops rendering "—".

### GAP-16 — idempotency-store.ts wrapper mints NULL locale — **CLOSED 2026-08-29**
- Type: TASK — the facade was DELETED (the cleaner of the two named fixes)
  on a grep-based caller inventory: no live code used it. Idempotency
  guarantee re-homed onto the real mint path with coverage growing.
  IngressServerOptions.idempotencyStore removed — a public-API change,
  acceptable under ADR-009 and already documented as ignored since GAP-11.
- Original finding:
- `idempotency-store.ts`'s `getOrCreateForResolution` wrapper calls
  `registryStore.getOrCreateByResolutionKey` without the `locale` param
  clause 2 added. Not on the server or embed mint path (both go through
  `submit-resolution.ts`, which passes it), so no effect on the gate — but a
  future caller of the wrapper would mint a NULL-locale row silently. The
  wrapper is also already flagged as a deprecated/ignored path since
  GAP-11 (`IngressServerOptions.idempotencyStore` is ignored).
- Closes when: either the wrapper threads `locale` through (one param), or
  the now-unused `IdempotencyStore` facade is deleted outright (the cleaner
  fix — GAP-11's commit already named it a cleanup candidate). Sequenced
  after GAP-07/08 lands (same tree).

### GAP-17 — Residual per-type switches in the engine after GAP-08
- Type: SEAM — **CLOSED 2026-08-29** at `ed81ace`; gate-check PASS 8/8
  (corpus-qa, scratch worktree). `retentionYears` + `ownerIdPath` on
  `DocumentTypeDefinition`, validated atomically at registration (NaN and
  non-integers rejected; path parsed by the frozen grammar); all three
  switches gone; built-ins byte-identical (6/10/3, `header.employeeId`);
  generic proof via a test-local `locker-slip` type; boundary lint fires on
  planted `documentType === 'payslip'` / `case 'invoice':` and stays silent
  on the same text in comments. (Surfaced 2026-08-29 by the GAP-07/08
  gate-check, which correctly noted the commit message's "engine knows no
  document type" was overstated.)
- GAP-08's wording was the hardcoded template map, and that is gone. But
  three per-type switches remain in engine source, each a `documentType
  === 'payslip'`-style branch rather than something the document type's
  owner supplies via `DocumentTypeDefinition`:
  - `archive/retention-policy.ts` hardcodes retention years per type
    (purchase-order 3, invoice 10, payslip 6, default 10);
  - `authorization/authorization-port.ts` branches on `'payslip'` and
    `extractPayslipOwnerId` is called from `create-output.ts`;
  - `console.ts` gates the lock glyph on `'payslip'`.
- Closes when: `DocumentTypeDefinition` optionally carries `retentionYears`
  and an `ownerIdPath` (or extractor), the three switches read from the
  registry instead, and the engine-boundary test grows a rule that no
  non-test engine file string-compares a `documentType` literal. NOT
  urgent: the standalone product ships with exactly these three built-in
  types, so the switches are correct today — this is about the seam being
  fully honest, not a defect.
- Sequenced after GAP-10 and GAP-16 (same files).

### GAP-19 — Lifecycle bootstrap: a file edit can seed `published` (S1 exposure)
- Type: DECISION — **RATIFIED 2026-08-29 (S1), logged so it is never implicit**
- Stage 5 task 1 persists template lifecycle in an append-only log; the
  registered meta's `lifecycle` is the declared INITIAL state and seeds
  the log on first registration. A document-type file that declares a
  NEW version as `published` therefore seeds straight to published — the
  runtime approval gate (task 3) is bypassable by editing a file and
  redeploying.
- Maintainer ratified **S1: accept it — file review is the governance.**
  Consistent with ADR-003, already accepted for rules (a rule edit
  reroutes live documents with no runtime approval; git review governs
  files). The seed row still records who/why (`actor.role:
  'registration'`, `subjectId: 'definition:<type>'`). S2 (cap seeds at
  `draft` unless the file carries a bootstrap approval) was rejected: the
  "approval" is still just a file, and it breaks every test for little
  real governance.
- Revisit trigger: if a non-developer ever gains write access to
  document-type files without git review, S1's premise fails.

### GAP-20 — Publishing a new version does not retire the superseded one
- Type: TASK — **OPEN, low priority** (named by the Stage 5 task-1 ruling as
  "log it, do not solve it")
- Two `published` metas with identical variants tie-break by registration
  order; publishing v2 of a template leaves v1 `published` too. Correct
  for task 1 (auto-retire is a policy, not a state-machine property) but a
  real operational trap: an operator publishing v2 may expect v1 to stop
  winning.
- Closes when: either publish auto-retires the superseded same-variant
  version (policy decided by the maintainer), or the review-and-approve
  screen (task 4) makes the superseded version's continued live status
  visible so it can be retired explicitly.

### GAP-21 — LIFECYCLE_STATES is a hand-maintained mirror of the schema union — **CLOSED 2026-08-29**
- Type: TASK — a single `satisfies Record<TemplateLifecycle, true>` on a
  keyed object enforces BOTH directions (missing member = missing-property
  error; extra key = excess-property error); the array is derived via
  `Object.keys`, runtime value and order unchanged. Proven to bite: a fake
  `'archived'` union member fails `npm run typecheck` pointing at
  transitions.ts. 394/394.
- Original finding:
- `packages/runtime/src/lifecycle/transitions.ts` declares
  `LIFECYCLE_STATES` as an array mirroring `TemplateLifecycle`
  (`packages/schema/src/document/template.ts`). The transition table's
  exhaustiveness test derives illegal pairs from that array — so if the
  schema union ever grows a state, the test silently keeps passing on the
  stale array, and the new state is neither legal nor refused-by-test.
- Closes when: the array is tied to the union at the type level (e.g.
  `satisfies readonly TemplateLifecycle[]` plus a reverse check that every
  union member is present — a `Record<TemplateLifecycle, true>` keyed
  object is the cheapest), so adding a union member is a compile error
  until the array and table are updated. One-line fix; no behaviour change.

### GAP-22 — Reproduce-and-deliver: reproduce returns bytes only
- Type: SEAM — **OPEN, low priority** (named by the Stage 5 task-2 ruling)
- `reproduce` returns the archived bytes and stamps the audit log; it
  does NOT re-deliver to a channel. Reasons ruled: the registry row holds
  no recipients (they live on delivery jobs); the email channel needs a
  message template rendered from a payload the runtime does not hold
  (GAP-10) — a reproduce-to-email would have to send a bare attachment,
  which GAP-10 forbids. Task 4's console consumes bytes as a download.
- Closes when: `reproduce` gains `deliverTo?: { channel, recipients }` for
  object-store/fs channels only (no message needed), or a decision on
  what an email re-delivery's subject/body should be without the payload.

### GAP-23 — Visible REPRINT watermark needs a grammar root
- Type: DECISION — **OPEN, human-only** (named by the Stage 5 task-2 ruling)
- ROADMAP task 2 says "state stamps as metadata + optional watermark". The
  metadata stamp is built (reprint_log). A VISIBLE watermark on a
  regenerated document is closed by the frozen expression grammar:
  `text.value` must be an envelope-rooted path (roots fixed to
  schemaVersion/documentType/header/lines/totals, no literals), and every
  contract is `additionalProperties: false`, so "REPRINT of <docId>"
  cannot be expressed as a DocNode nor smuggled into the data. Options:
  a `reprint` root in the grammar (grammar doc first, then parser —
  reviewed as an ADR-005-style change), or a renderer-level overlay
  (gold-plating a renderer, CLAUDE.md). The ruling prefers the grammar
  route if the maintainer wants it at all. Never a modification of
  archived bytes (POLICY.md).
- Closes when: the maintainer decides yes/no; if yes, a grammar-doc change
  precedes the parser change (docs/EXPRESSION-GRAMMAR.md's own rule).

## Gate

### GAP-13 — Thesis validated with N=0 operators
- Type: GATE — **OPEN, human-only; Stage-5 EXCEPTION RATIFIED 2026-08-29**
- ~2 stages built past an open thesis check. Under GAP-01 = standalone
  product, the operator demo IS the validation (not "first consumer
  wired") — this gap is unambiguously `GATE-S3-THESIS-CHECK`.
- **Ratified exception (maintainer, in chat, 2026-08-29):** the loop may
  proceed into Stage 5 (Governance) while `GATE-S3-THESIS-CHECK` stays
  open. Reasoning accepted: Stage 5 is governance the product needs
  regardless of what operators say about the demo, and idle time is worse
  than a re-prioritisable build. This satisfies the "ratified exception"
  arm of the close condition for the purpose of unblocking Stage 5 — it
  does NOT close the gate itself.
- Still closes when: 5-operator demo done, `docs/PREMORTEM.md` written.
  The demo is built and runnable (`npx tsx packages/runtime/src/index.ts`,
  or the Dockerfile); only the human step remains.

## Hygiene

### GAP-14 — Canon drift: three docs state falsehoods — **CLOSED 2026-08-29**
- Type: HYGIENE
- Was: README said "Stage 0 closing"; CLAUDE.md said "no Dockerfile/CI
  exists yet"; HLD §12 said console pages are busy-office-ui pages.
- Closed: all three amended in one session (CLAUDE.md first). README now
  states real status + the licence interim; CLAUDE.md now names the
  Dockerfile and the still-broken CI honestly (GAP-12); HLD §12 now says
  plain server-rendered HTML with `busy-office-ui` as a deliberately-
  diverged sibling, not a dependency.

## Blocking graph (post-ratification)

```
GAP-01 ✓ ──┬─▶ GAP-07 contract shape ──▶ GAP-08 registration
GAP-02 ✓ ──┘
GAP-04 ✓ ──▶ template-tool scope (settled: developer-as-code)
GAP-03 ──▶ Stage-4 exit gate
GAP-13 ──▶ Stage-5 start (unless exception ratified)
GAP-11, GAP-12, GAP-14 ──▶ independent, Claude-doable now
GAP-05, GAP-06 ──▶ independent, human-only
```

Session A (GAP-01/02/04) — done 2026-08-29.
Session B (GAP-03/05/06/13) — pending.
GAP-11/12/14 — schedule as sessions, no ceremony.
