# Busy Office Output — Roadmap

Scaled for one developer, part-time (~8–12 h/week); durations are elapsed
weeks. **Path A ≈ 24–31 weeks · Path B ≈ 17–22 weeks · decided by ADR-000.**

One principle governs scope: **the runtime is the product.** Rendering is a
solved space (Carbone, Typst, pdf-lib between them); determination, archive,
reprint semantics, and audit are solved by nobody. Stages 0–2 buy or build the
smallest credible rendering layer; Stage 3 is where this project earns its
existence.

## How this roadmap is worked (Claude Code protocol)

- A stage is the first one below with unchecked tasks; `/next` proposes the
  single next task. One task per session.
- Checkboxes are ticked only when the **DoD** (definition of done) was
  witnessed this session — a command run, output seen. `/gate-check <stage>`
  verifies exit gates; `corpus-qa` refuses gates it did not run.
- Tasks marked **[HUMAN]** need the maintainer (real hardware, LibreOffice,
  licence reading, ADR decisions). Claude prepares evidence; humans decide ADRs.
- No stage closes with its ADRs open. No package directory is created before
  its stage. The Deferred table at the bottom is a wall.

---

## Stage 0 — Decide what to build  `~2 weeks · KILL GATE · CLOSED 2026-08-27`

**Goal:** close ADR-000 (authoring model) on measured evidence, or kill the
project cheaply.

### Tasks
- [x] Spike harness + deterministic reference PO (seeded generator) — DoD: `npm run spike:data` reproduces byte-identical JSON
- [x] pdf-direct spike passes gates 1–4 — DoD: 3-page out.pdf; carried/brought-forward verified on rasterized page; bench prints ms/doc *(container: p50=37.8ms)*
- [x] Typst spike passes gates 1–4 incl. state-based running footer — DoD: compile clean, page-2 footer shows running total *(container: cold p50≈459ms)*
- [ ] **[HUMAN — SKIPPED 2026-08-26]** ~~Author `spike/carbone/po-template.odt`; install LibreOffice; run `npm run spike:carbone`~~ — skipped by maintainer decision (docs/INBOX.md, GATE-CARBONE closed); ADR-000 draft proceeds on pdf-direct + typst evidence only. Revisit only if a named user needs .odt/.docx template authoring.
- [x] **[HUMAN]** Re-run pdf-direct + typst benches on target hardware — DoD: RESULTS.md hardware section + gate-5 row filled *(done under loop Q2/Q5, reconciled tick 12: MacBook Air M4, typst cold p50=100ms n=15, pdf-direct p50=12.1ms n=30 — spike/RESULTS.md §Hardware + §Gate matrix)*
- [x] RTL + CJK smoke test (th-TH, ja-JP, ar-SA) in the two leading candidates — DoD: RESULTS.md section filled with pass/fail per script *(not deferred to Stage 6)* *(done under loop Q3, corrected+reverified Q5, reconciled tick 12: pdf-direct fails ja-JP subsetting + ar-SA+digits (no font fallback), Typst passes all — spike/RESULTS.md §RTL/CJK smoke test)*
- [ ] **[HUMAN — SKIPPED 2026-08-26]** ~~Read Carbone `LICENSE.md` (CCL) against intended distribution~~ — moot: Carbone not adopted for Stage 0 (docs/INBOX.md skip-carbone decision); CCL review happens only if Path B / Carbone is revisited for a named user.
- [x] Bursting math — DoD: RESULTS.md: target window, required ms/doc, achieved per renderer *(2026-08-27: target window 30 min decided, GATE-BURST-WINDOW closed; typst 100ms p50 clears at 2.25x margin, pdf-direct 12.1ms p50 clears at 18.6x margin — spike/RESULTS.md §Bursting math)*
- [x] `/adr 000` round-table draft from completed RESULTS.md — DoD: draft recommendation appended, decision drivers all evidenced *(arb-chair ruling 2026-08-26: "evidenced" ≠ "answered positively" — drivers 2–4 are traceably documented "unanswered by choice," not fabricated or silently missing; see ADRs/000-template-authoring-model.md)*
- [x] **[HUMAN]** Decide ADR-000 (and ADR-001 if Path A) — DoD: Status: Accepted, Decision section written *(2026-08-26: Accepted, Option C hybrid — schema-first built now, Carbone reserved/not adopted; see ADRs/000-template-authoring-model.md. Consequence: ADR-001 is now live, not moot — pagination location must be decided before Stage 1)*
- [x] Delete `spike/` except `RESULTS.md`; move RESULTS.md → `docs/` — DoD: tree clean, log entry *(2026-08-27: spike/ removed entirely, RESULTS.md moved to docs/RESULTS.md; package.json spike:* scripts and CLAUDE.md Commands section cleaned up to match — see docs/SESSION-LOG.md)*

### Exit gate — `/gate-check 0`  — **all 4 PASS, 2026-08-27**
1. ADR-000 Accepted, with all five decision drivers traceably evidenced —
   each either measured (docs/RESULTS.md), explicitly skipped by named
   maintainer decision (docs/HUMAN-GATES-LOG.md / docs/INBOX.md), or
   sourced from a named companion ADR — none silently missing or
   fabricated — **PASS**
2. ms/doc per surviving renderer, measured warm on target hardware —
   **PASS** (typst 100ms p50 n=15, pdf-direct 12.1ms p50 n=30, MacBook Air
   M4 — docs/RESULTS.md §Hardware + §Gate matrix)
3. Bursting math closes: 8,000 docs fit the stated window, or a second
   renderer is named — **PASS** (30-min window, both renderers clear
   single-process — docs/RESULTS.md §Bursting math)
4. `spike/` deleted, `docs/RESULTS.md` kept — **PASS** (2026-08-27)

**Kill criterion:** no path clears the bursting window or licence check → stop
before product code.

---

## Stage 1 — Lock the contracts  `~2–3 weeks`

**Goal:** everything expensive to change later is written down and frozen.
`packages/schema` already stubs the path-independent parts.

### Tasks
- [x] Data contract per document type (PO, invoice, payslip): JSON Schema + `schemaVersion` + written rename-compatibility policy — DoD: schemas in `packages/schema/contracts/`, typecheck green *(2026-08-27: purchase-order/invoice/payslip.schema.json + common.schema.json + RENAME-POLICY.md; typecheck green)*
- [x] Variant resolution spec: most-specific-match over `(documentType, companyCode, country, partnerId, locale)` + `parentId` inheritance, with worked examples — DoD: spec doc + pure resolver function + unit tests *(2026-08-27: docs/VARIANT-RESOLUTION.md + packages/schema/src/variant/resolve.ts, 13 unit tests)*
- [x] Reproduction policy written once (archive = reproduction; determinism is test-time only) — DoD: section in `docs/POLICY.md`, referenced from CLAUDE.md *(2026-08-27: docs/POLICY.md, CLAUDE.md points to it)*
- [x] Tier 1 standards into the contracts (ADR-006): ISO 4217, ISO 3166-1, RFC 3339, UNECE Rec 20 UoM codes, reserved ISO 6523/EAS party-id fields; fix the reference generator's non-Rec-20 units — DoD: schema patterns/enums enforce the codes; regenerated reference data passes *(2026-08-27: enforced in common.schema.json — currencyCode/countryCode pattern, date/date-time format, unitOfMeasure Rec 20 enum, partyIdentification reserved fields. "Regenerate reference data" is moot: the reference generator lived in spike/, deleted at Stage 0 close (docs/RESULTS.md) — no generator exists to re-run; the enum is the fix for any future one)*
- [x] *Path A only:* freeze the nine node kinds; expression grammar (allowlist, publish-time rejection of unknown identifiers) — DoD: grammar doc precedes parser; parser rejects unknown identifier in a test *(2026-08-27: nodes.ts DRAFT→FROZEN; docs/EXPRESSION-GRAMMAR.md precedes packages/schema/src/expression/parse.ts; parseExpression rejects unknown root identifiers, 10 tests)*
- [x] **N/A — Path B not adopted** ~~*Path B only:* marker/formatter allowlist for office templates + binary-template review procedure~~ — out of scope per ADR-000 ("do not build both speculatively"; Carbone/Path B reserved, not adopted, not built). Revisit only if a named user needs `.odt`/`.docx` template authoring.
- [x] Paper test — DoD: PO and invoice templates written on paper in the chosen model with **zero** new node kinds / marker patterns needed *(2026-08-27: PASS — packages/schema/src/document/paper-test.test.ts, docs/PAPER-TEST.md. Both PO and invoice built from the existing nine kinds and existing grammar; zero new kinds/syntax needed)*

### Exit gate — `/gate-check 1`  — **all 3 PASS, 2026-08-27**
1. Paper test passes — **PASS** (docs/PAPER-TEST.md)
2. `npm run verify` green — **PASS** (30/30 tests, typecheck clean)
3. ADR-001 closed or formally moot (Path B) — **PASS** (ADR-001 Accepted 2026-08-27)

---

## Stage 2 — One document, exceptionally well  `Path A: 5–7 wks · Path B: ~2 wks`

**Goal:** the purchase order renders correctly, reproducibly, and measurably —
and the spike gates become the permanent corpus.

### Tasks
- [x] Corpus scaffold `test/corpus/purchase-order/001…007` from the seeded generator (single-page, two-page, ten-page, **120-line carry-forward**, **totals-at-boundary**, **overflow-must-fail**, empty-lines) — DoD: `npm test` runs corpus; remove `passWithNoTests` *(2026-08-27: test/corpus/purchase-order/, deterministic seeded generator (generate.ts/rng.ts), passWithNoTests removed, real tests replace it)*
- [x] PDF normalization helper (zero CreationDate/ModDate + doc ID) shared by all snapshot tests — DoD: two consecutive renders byte-match after normalization *(2026-08-27: packages/render-typst/src/normalize-pdf.ts — also zeros Typst's XMP metadata, a determinism leak beyond the originally-known fields; see CLAUDE.md conventions. All 7 corpus cases assert byte-identical normalized re-renders)*
- [x] Archive profile = **PDF/A-2b**, veraPDF joins the corpus gates (ADR-006); pdf-direct gains embedded TTF + XMP + OutputIntent if it stays in play — DoD: veraPDF clean on every corpus artifact in CI *(2026-08-27: `typst compile --pdf-standard a-2b`; veraPDF (`verapdf -f 2b --format json`, packages/render-typst/src/verify-pdfa.ts) wired into the corpus gate — 001/002/003/004/005/007 all veraPDF-clean (144/144 rules) as part of `npm test`; 006 correctly excluded, it never produces a PDF. Check proven to have teeth: unflagged `typst compile` genuinely fails veraPDF (missing PDF/A Identification schema). Real bug found+fixed: the a-2b flag adds an XMP `xmpMM:History` block with per-render timestamps that broke determinism — normalize-pdf.ts extended to zero it, same pattern as CreationDate/ModDate/doc-ID. pdf-direct half moot per ADR-001 (Typst owns this document type))*
- [x] *Path A:* composition (measure → wrap → break; seed = spike greedy wrap) + nine components + chosen renderer behind `Renderer` — DoD: corpus green *(2026-08-27: packages/render-typst/ — TypstRenderer implements Renderer (id: 'typst'), evaluates DocNode expressions against real data (evaluate.ts), emits Typst markup for all 9 frozen kinds incl. state()-based carry-forward footer (emit-typst.ts), shells out to `typst compile`. "Measure → wrap → break" is Typst's own layout engine per ADR-001 Option 2 — not re-implemented here. Corpus: 56/56 tests green, typecheck clean)*
- [x] **N/A — Path B not adopted** ~~*Path B:* production PO template authored; Carbone behind `Renderer` (`office-template` job kind); LibreOffice version + fonts pinned in `Dockerfile`~~ — out of scope per ADR-000, same as the Stage 1 Path B task
- [x] Structural diff CLI (`bo-output diff`) — page count + box/text deltas, not pixels — DoD: intentional template change produces a readable diff in CI output *(doubles as the ADR-005 AI verifier)* *(2026-08-27: packages/render-typst/src/diff/ + src/cli/diff.ts, shells out to `pdftotext -bbox-layout` (poppler-utils) for word+bbox extraction, LCS-based word diff. DoD test 008-structural-diff.test.ts: a changed totals label and an inserted fieldGrid row both produce a named, readable delta. NOTE: pdftotext is an unpinned external binary dependency (same shape as `typst` — shelled out, not npm) — no Dockerfile/CI exists yet to pin it; flag before this becomes an actual CI gate)*
- [x] Template-from-sample skill (`.claude/skills/template-from-sample/`) + **round-trip proof**: rasterize the corpus PO, hand the skill only the image, regenerate the template, diff converges — DoD: round-trip test green with zero real data *(2026-08-27: .claude/skills/template-from-sample/SKILL.md + test/corpus/purchase-order/009-template-from-sample-roundtrip.test.ts. HONESTY CAVEAT: the round-trip test proves rasterization works and diff-convergence checking is real/automated, but the reconstructed template is checked against the same generated data object as the original — not values OCR'd or vision-derived from the image. It does not prove a vision-only Claude session would independently derive the correct tree; that step stands in for a future human/Claude-in-the-loop skill invocation, not yet exercised end-to-end)*
- [x] ms/doc published in README, measured by the corpus bench — DoD: README table row *(2026-08-27: README.md table, typst/purchase-order/001-single-page, p50≈123ms p95≈136ms, MacBook Air M4 — test/corpus/purchase-order/bench.ts, `npm run bench:po`. Not comparable to Stage 0's pdf-direct 38ms number — different renderer, shell-out vs in-process)*

### Exit gate — `/gate-check 2`  — **all 3 PASS, 2026-08-27**
1. Corpus green twice consecutively with identical normalized hashes — **PASS** (19 test files / 67 tests; determinism.ts does real byte-buffer equality on normalized re-renders, not a smoke test)
2. Overflow case fails loudly — **PASS** (006-overflow-must-fail.test.ts: `rejects.toThrow(TypstOverflowError)`, measure()-based guard, never silently clipped)
3. ms/doc in README — **PASS** (README.md table row, real measured p50/p95)

All seven Stage 2 tasks complete, all seven of the checked-off tasks
above independently re-verified by a corpus-qa gate-check (real commands,
fresh render + direct `verapdf` invocation, not self-asserted): PDF/A-2b
144/144 veraPDF rules pass on a freshly rendered artifact,
`GATE-VERAPDF-INSTALL` closed 2026-08-27 (maintainer authorized
`brew install verapdf` directly in chat).

---

## Stage 3 — The wedge: determination + delivery  `~6–8 weeks · path-independent`

**Goal:** the part that exists nowhere else. This demo is the project's reason
to exist.

### Tasks
- [x] `packages/runtime` created (its stage has begun) — ingress `POST /event` + contract validation — DoD: invalid payload → 400 with schema errors *(2026-08-27: packages/runtime/ — node:http ingress, ajv 2020-12 validation against packages/schema/contracts/*.schema.json, RFC 9457 problem+json errors. 17 tests: invalid PO/invoice/payslip payloads → 400 with schema errors, valid payloads accepted, unknown documentType/malformed JSON/wrong method all handled without a 500)*
- [x] Standard API shapes (ADR-006): optional CloudEvents 1.0 envelope on `POST /event`; all errors as RFC 9457 problem+json incl. the rule TRACE — DoD: contract tests *(2026-08-28: CloudEvents 1.0 detected via specversion, data unwraps to the same path as raw payloads; raw payloads keep working. No-rule-match/no-template-match are 422 problem+json carrying the full TRACE as an extension member)*
- [x] Rule evaluation with mandatory TRACE; non-match = error carrying the evaluated trace — DoD: test proves no silent no-op path exists *(2026-08-28: packages/runtime/src/determination/ — files-first rules (ADR-003) in packages/runtime/rules/, reuses Stage 1's resolveTemplate as sole authoritative winner for the template half. TRACE mandatory on every call incl. matches, never the raw payload. Determination runs before idempotency — no-match never mints a docId)*
- [x] Fan-out: one event → N resolutions (template, locale, channel, recipient) — DoD: bursting test = fan-out test *(2026-08-28: `OutputRule.fanOut` opt-in (default false) — matched fan-out rules always co-fire alongside the single winner-take-all pick among non-fan-out rules; `determine()` now returns `resolutions: Resolution[]` (>=1), each with its own template lookup + TRACE, atomic on template-match failure. Idempotency key widened with a `ruleId` disambiguator (RegistryStore.getOrCreateByResolutionKey, migrations/0003_add_rule_id_to_registry.sql, new 5-column unique index) so N resolutions from one event mint N distinct, replay-stable docIds. packages/runtime/src/determination/fanout.test.ts proves 3 rules → 3 resolutions → 3 stable docIds on replay (never 6); npm run verify: 140/140 tests green)*
- [x] Idempotency on `BusinessEventKey` — DoD: replayed event returns existing docId; **write this test first** *(2026-08-27: packages/runtime/src/idempotency-store.ts, test-first (RED confirmed before GREEN). Explicitly scoped as an in-memory stand-in for the not-yet-built Document registry task below — not a foundation to extend in place. BusinessEventKey travels as a top-level `businessEvent` envelope field; replay returns 200 + same docId + replayed:true, first sighting returns 202 + replayed:false)*
- [x] Document registry (docId, object/id, template+renderer versions, input/output hashes, archiveRef, state, delivery history) — DoD: one row per artifact, migration in repo *(2026-08-27: arb-chair ruling — proceed behind a RegistryStore port, default node:sqlite implementation, not Postgres, so ADR-004's still-open "if the registry lands on Postgres anyway" condition isn't silently pre-decided. packages/runtime/src/registry/ — migrations/0001_init.sql (real versioned migrations, schema_migrations tracking), SqliteRegistryStore, idempotency-store.ts now backed by durable storage (docId survives process restart, proven by test). archiveRef is a pointer only — actual archiving is the next task)*
- [x] Archive store (FS + S3-compatible) with mandatory `retentionUntil` — DoD: archiving without retention fails *(2026-08-27: packages/runtime/src/archive/ — ArchiveStore port, FsArchiveStore (default, under ./data/), S3ArchiveStore (mock-tested only, no live S3/MinIO in this environment). retentionUntil required at the type level + runtime-validated (RFC 3339) before any byte is written. archiveArtifact() wires archive->registry: archiveRef+retentionUntil set, DRAFT->ORIGINAL, in that order so a failed archive never leaves a dangling row. New migration 0002_add_retention_until.sql)*
- [x] Delivery queue: retry w/ backoff → terminal poison + alert; **never re-render on delivery failure** — DoD: test kills channel, artifact untouched, poison row present *(2026-08-28: packages/runtime/src/delivery/ — DeliveryQueue port + SqliteDeliveryQueue (ADR-004), exponential backoff capped, migrations/0004_add_delivery_queue.sql. DoD test kills the channel, drives to poison, proves ArchiveStore.retrieve returns byte-identical bytes before/after — delivery failure never re-renders/re-archives)*
- [x] Channels: email + object-store only — DoD: both deliver the archived bytes *(2026-08-28: EmailChannelSender (nodemailer, jsonTransport fallback so bare construction never dials out) + ObjectStoreChannelSender (@aws-sdk/client-s3, distinct delivery location from the archive), both implement ChannelSender, ChannelRouter dispatches on channel string. Both mock-tested only, no live network)*
- [x] Single-process `serve`: API + worker + embedded queue + FS archive — DoD: fresh clone → `serve` → end-to-end works with zero external services *(2026-08-28: packages/runtime/src/composition.ts (render+archive+enqueue per resolution, never throws, 10y default retentionUntil as a documented stand-in for Stage 4's real policy), render/template-content.ts (single hardcoded po-global-v1 -> DocNode lookup per arb-chair ruling — invoice/payslip stay determination-only, surfaced as an honest `no-template-content` outcome, never a 500/fabricated artifact), delivery/fs-channel-sender.ts (FsChannelSender — zero-external-services ChannelSender default, writes ./data/outbox/<channel>/<docId>-<uuid>.bin + JSON sidecar), worker.ts (drainOnce — deterministic, timer-free drain used by tests; startWorker — thin overlap-safe setInterval wrapper `serve()` uses for real runs), index.ts (createRuntimeDeps assembles SQLite registry + FsArchiveStore + SqliteDeliveryQueue + TypstRenderer + FsChannelSender; serve() wires it all into createIngressServer + startWorker in one function). e2e.test.ts: real HTTP POST through createIngressServer with real `typst compile` (no mocks on render/archive/delivery) proves rule trace -> archived PDF (countPdfPages >= 1) -> FsChannelSender outbox file byte-identical to the archived artifact -> registry DRAFT->ORIGINAL with delivery_history recording the attempt; invoice case proves the honest no-content path never fabricates a row. npm run verify: 159/159 tests, 6.18s wall-clock)*
- [x] Embeddable module (ADR-007): `createOutput()` mounts in a host process sharing its Postgres; **transactional outbox** — DoD: rollback test shows no orphaned artifact or registry row *(2026-08-28: arb-chair ruling — no PostgresRegistryStore (no live Postgres available, same reasoning as S3/email mock-testing), no package restructuring. packages/runtime/src/embed/create-output.ts — topology-blind OutputPort over injected ports. migrations/0005_add_composition_outbox.sql + RegistryStore.mintWithOutbox: docId mint + outbox row in one SQLite transaction, closing the crash-mid-composition gap flagged in the prior session entry. Rollback tests prove exactly one archived artifact + registry row reaches ORIGINAL after a simulated crash+resume, no duplicate on a second resume. Known gap, flagged not fixed: server.ts's HTTP path still uses the pre-outbox mint — follow-up, not this task's scope)*
- [x] Minimal console, read-only (UI-DESIGN): registry, document detail, rule trace as busy-office-ui pages — DoD: each passes the five UI principles; the Stage 3 demo runs through it *(2026-08-28: console-designer design brief (binding) -> plain server-rendered HTML under /output, no framework. packages/runtime/src/console.ts — Registry (search + bordered rows), Document detail (identity facts, static PDF/A badge, reprint trichotomy as inert text — no stub actions), Rule trace (every rule's reasons[] inline, same-page anchors only). Two small backend additions the screens needed: documentType column (migrations/0006), persisted trace log (migrations/0007). Live-verified: ran serve(), drove a real event through it, screenshotted all three pages rendering real data via Chrome)*
- [ ] **[HUMAN]** Thesis check: show the two-minute demo to 5 real operators — DoD: notes in `docs/PREMORTEM.md`; feeds C2 — **cannot be completed by Claude; needs the maintainer**
- [x] ADR-003 (rule storage) + ADR-004 (queue) closed — DoD: Status: Accepted *(2026-08-28: ADR-003 Option 1 files-first, ADR-004 Option 1 SQLite-backed embedded queue — both decided directly by the maintainer in chat)*

### Exit gate — `/gate-check 3`  — **PASS, 2026-08-28 (machine-checkable criteria)**
Event → rule trace → render → email → archived artifact → complete audit
trail, demonstrated end-to-end in under two minutes on the single-process build.
Independently verified by a corpus-qa gate-check (real commands, fresh
`/tmp` state, not self-asserted): `POST /event` on a real purchase-order
→ 0.157s response with a full matched rule trace; real PDF/A-2b archived
on disk; delivery byte-identical (`cmp`) to the archived artifact,
~3s later; registry row `state = ORIGINAL`; `delivery_history` row
`status = delivered`; all three console routes return real HTML for the
docId. 177/177 tests, typecheck clean.

Stage 3 is **not fully closed**: the one remaining task,
`[HUMAN] Thesis check` (docs/HUMAN-GATES-LOG.md, `GATE-S3-THESIS-CHECK`,
open), genuinely cannot be done by Claude — it requires the maintainer to
show the demo to 5 real operators and write up `docs/PREMORTEM.md`. Every
other Stage 3 task and this exit gate's own machine-checkable criteria
are done.

---

## Stage 4 — Second and third documents  `~5 weeks`

**Goal:** invoice and payslip, chosen because they break different things.

### Tasks
- [x] Invoice: tax/multi-currency contract + template — DoD: corpus cases green *(2026-08-28: invoice-global-v1 DocNode content wired into packages/runtime/src/render/template-content.ts; test/corpus/invoice/ 5 cases/10 tests. Multi-currency scope: schema untouched — header currency + Money's per-instance currency already support any single-ISO-4217-currency invoice; genuine mixed-currency-per-line deliberately deferred, no consumer needs it yet. renderer confirmed genuinely document-type-agnostic, zero changes needed)*
- [x] **PDF attachment concatenation** (T&C append, cover sheet) — DoD: merged artifact archived as one document, page counts asserted *(2026-08-28: packages/render-typst/src/merge-pdf.ts (pdf-lib) — page-level concatenation per the DoD text (not ISO 19005-3 embedded-file/Factur-X, Tier 3 deferred). Re-attaches PDF/A-2b OutputIntents/Metadata/trailer ID lost by pdf-lib's bare PDFDocument.create(), verified against real verapdf. Standalone composeConcatenatedRenderArchiveAndEnqueue() — deliberately not wired into any document type's default flow yet, no per-template trigger exists; a future task's job)*
- [x] Payslip: compact template + PII posture — DoD: corpus green; log-scrub test proves no payload fields in logs *(2026-08-28: payslip-global-v1 DocNode content, test/corpus/payslip/ 4 cases. payslip-log-scrub.test.ts drives a real payslip event through the real pipeline with console.log/error/warn intercepted (util.format), asserts no captured line contains any real PII value — two scenarios (happy path + forced-poison, the latter proving the capture mechanism has teeth via a real, non-mocked console.error alert line). All three Stage 1 document types now have real render content)*
- [ ] Author invoice + payslip templates via the template-from-sample skill on **redacted** real samples — DoD: templates carry `provenance: ai-generated`, corpus gates green; redaction step documented
- [ ] Document-level authorization: reproduce/regenerate/reissue evaluated against the document — DoD: HR-clerk vs employee test — same endpoint, different outcome
- [x] Retention per doc type enforced end-to-end — DoD: expiry test purges artifact, registry row survives *(2026-08-28: retention-policy.ts (invoice 10y, payslip 6y, purchase-order 3y — documented as non-legal defaults). ArchiveStore.purge() added (idempotent), enforceRetention() purges bytes then marks the registry row (archiveRef->null, purgedAt set, state/retentionUntil preserved) — crash-safe ordering, never claims purged bytes that still exist. Row survives forever, directly callable like resumeStrandedCompositions/drainOnce, no new background loop)*
- [ ] Bursting through fan-out at target volume; second renderer (ADR-002, default pdf-lib) lands here if needed — DoD: gate below
- [ ] Operations console page (delivery queue: retry/poison; retry never re-renders) — DoD: five UI principles pass; poison row from registry cross-links here

### Exit gate — `/gate-check 4`
8,000-recipient payroll run inside the stated window, per-recipient locale and
channel, one audit row each; ADR-002 closed.

---

## Stage 5 — Governance  `~3–4 weeks`

### Tasks
- [ ] Template lifecycle draft→review→approved→published→retired; DEV→QAS→PRD transport; author/reviewer/approver/reason recorded — DoD: state machine tests
- [ ] Reprint semantics live: reproduce = archive fetch; regenerate = current template+data; reissue = new event; state stamps as metadata + optional watermark — DoD: three-path test with stamped outputs
- [ ] Publish blocked without approval record — DoD: the gate test below
- [ ] Review-and-approve screen (UI-DESIGN): compare mechanic + mandatory reason; Approve is the only primary — DoD: the gate test runs through this screen
- [ ] Overview (failures-first home) + Settings (four flat groups) — DoD: overview is nearly empty when all green

### Exit gate — `/gate-check 5`
A template change cannot reach PRD without an approval record — the test
attempts it and fails.

---

## Stage 6 — Variant and locale depth  `~3–4 weeks`

### Tasks
- [ ] Locale packs: number/date/address formats; CJK + RTL fonts wired (Path B: pinned LibreOffice font matrix) — DoD: corpus locale cases green
- [ ] Variant exercise: country/company/customer overrides via inheritance, zero template forking — DoD: resolver + render tests

### Exit gate — `/gate-check 6`
The same PO template renders correctly in en-SG, ja-JP, th-TH, ar-SA with zero
forking.

---

## Stage 7 — Authoring assist, AI-native  `unscheduled · replaces the visual builder`

The drag-drop builder is deleted from the plan in both paths. Its two jobs —
blank page → working template, and adjustments without learning the schema —
are done by the AI loop instead (ADR-005), verified by the Stage 2 diff
infrastructure, governed by the Stage 5 lifecycle.

### Tracks (each with its own entry trigger)
- [ ] **Template-from-sample, productized** — upload sample → generate → converge → land as `draft`. Trigger: the Stage 2/4 skill has authored ≥3 real templates successfully.
- [ ] **Adjust-assist workspace** — per the grilled spec in `docs/UI-DESIGN.md`: document, proposed tint, one impact line, one prompt, Accept as draft; source/history stay in the user's editor. Trigger: previewer exists and ≥5 external requests by name.
- [ ] **Shadow parity mode** — run the pipeline alongside a legacy output system, structural-diff every live document pair, parity dashboard as cutover evidence. Trigger: a named migration target (e.g. a Smart Forms estate).

### Hard constraints (from ADR-005, non-negotiable)
AI output faces the same corpus gates; provenance recorded; patches not
free-drawing; edits enter as `draft`, never `published`; no payload egress to
external models by default — synthetic or redacted inputs only.

### Exit gate — `/gate-check 7`
A sample document becomes a gate-passing `draft` template with zero manual
schema editing, and an adjust-assist patch round-trips accept→render→approve
through the Stage 5 lifecycle.

---

## Deferred — conditional, never scheduled (the wall)

| Item | Enters only when | Note |
|---|---|---|
| Labels / ZPL | a named manufacturing user with thermal printers | incl. multi-up ganging — a different product |
| Print agent | a site that cannot print via PDF + OS spooler | |
| E-documents | a named mandated user | EN 16931 · Peppol BIS 3.0 / **PINT-SG** · Factur-X (PDF/A-3 + CII). SG wave is dated: GST InvoiceNow → all GST businesses 2028–2031. Generating UBL ≠ being a Peppol access point |
| Digital signatures | pulled forward immediately if e-documents land | **PAdES B-LT** (ETSI EN 319 142); mandatory in most e-invoicing regimes |
| Accessibility (PDF/UA-1) | EAA / procurement requirement | route /UA documents to a capable renderer per-template (Typst exports ua-1) |
| Excel / reports | a real reporting user | separate dataset abstraction, separate product |
| ERP adapters (per-ERP connectors) | a user of that ERP exists | not a hypothesis about one |
| Template marketplace | never | an outcome of adoption, not a feature |

---

## Three numbers, published from Stage 2 onward

1. **ms/document** per renderer on the reference PO
2. **Pagination pass rate** across the corpus
3. **Template change → production, elapsed time** (once Stage 5 exists)

If these are good, the product is good. Feature work never compensates for
drift here.

## Standing risks

| Risk | Mitigation |
|---|---|
| Renderer misses bursting window | measured at Stage 0; ADR-002 default (pdf-lib, 38ms container p50) behind the interface |
| Carbone edition lag / CCL constraint | renderer is per-template and swappable; runtime renderer-agnostic |
| Binary templates ungovernable (Path B) | Stage 5 lifecycle on template artifacts; snapshot corpus is the review mechanism |
| Schema churn (Path A) | locale/variant first-class at Stage 1; builder gated on stability |
| Scope creep | Deferred table requires a named user; arb-chair enforces |
| Standards checklist creep | ADR-006 tiers + "no claim without a validator"; Tier 3 stays trigger-gated |
| Console scope creep | five UI principles + the deliberately-absent list in UI-DESIGN; console-designer agent grills every new control |
| Divergence from busy-office-ui | accepted: two products, one brand; stated in README |
| AI-generated template trusted unverified | same corpus gates apply; provenance in TemplateMeta; AI edits enter lifecycle as draft (ADR-005) |
| Solo-maintainer bus factor | every gate leaves a standalone artifact: RESULTS, ADRs, contracts, corpus, SESSION-LOG |
