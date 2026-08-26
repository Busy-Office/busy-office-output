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

## Stage 0 — Decide what to build  `~2 weeks · KILL GATE · in progress`

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
- [ ] Bursting math — DoD: RESULTS.md: target window, required ms/doc, achieved per renderer
- [x] `/adr 000` round-table draft from completed RESULTS.md — DoD: draft recommendation appended, decision drivers all evidenced *(arb-chair ruling 2026-08-26: "evidenced" ≠ "answered positively" — drivers 2–4 are traceably documented "unanswered by choice," not fabricated or silently missing; see ADRs/000-template-authoring-model.md)*
- [x] **[HUMAN]** Decide ADR-000 (and ADR-001 if Path A) — DoD: Status: Accepted, Decision section written *(2026-08-26: Accepted, Option C hybrid — schema-first built now, Carbone reserved/not adopted; see ADRs/000-template-authoring-model.md. Consequence: ADR-001 is now live, not moot — pagination location must be decided before Stage 1)*
- [ ] Delete `spike/` except `RESULTS.md`; move RESULTS.md → `docs/` — DoD: tree clean, log entry

### Exit gate — `/gate-check 0`
1. ADR-000 Accepted, with all five decision drivers traceably evidenced —
   each either measured (spike/RESULTS.md), explicitly skipped by named
   maintainer decision (docs/HUMAN-GATES-LOG.md / docs/INBOX.md), or
   sourced from a named companion ADR — none silently missing or
   fabricated
2. ms/doc per surviving renderer, measured warm on target hardware
3. Bursting math closes: 8,000 docs fit the stated window, or a second renderer is named
4. `spike/` deleted, `docs/RESULTS.md` kept

**Kill criterion:** no path clears the bursting window or licence check → stop
before product code.

---

## Stage 1 — Lock the contracts  `~2–3 weeks`

**Goal:** everything expensive to change later is written down and frozen.
`packages/schema` already stubs the path-independent parts.

### Tasks
- [ ] Data contract per document type (PO, invoice, payslip): JSON Schema + `schemaVersion` + written rename-compatibility policy — DoD: schemas in `packages/schema/contracts/`, typecheck green
- [ ] Variant resolution spec: most-specific-match over `(documentType, companyCode, country, partnerId, locale)` + `parentId` inheritance, with worked examples — DoD: spec doc + pure resolver function + unit tests
- [ ] Reproduction policy written once (archive = reproduction; determinism is test-time only) — DoD: section in `docs/POLICY.md`, referenced from CLAUDE.md
- [ ] Tier 1 standards into the contracts (ADR-006): ISO 4217, ISO 3166-1, RFC 3339, UNECE Rec 20 UoM codes, reserved ISO 6523/EAS party-id fields; fix the reference generator's non-Rec-20 units — DoD: schema patterns/enums enforce the codes; regenerated reference data passes
- [ ] *Path A only:* freeze the nine node kinds; expression grammar (allowlist, publish-time rejection of unknown identifiers) — DoD: grammar doc precedes parser; parser rejects unknown identifier in a test
- [ ] *Path B only:* marker/formatter allowlist for office templates + binary-template review procedure — DoD: `docs/TEMPLATE-POLICY.md`
- [ ] Paper test — DoD: PO and invoice templates written on paper in the chosen model with **zero** new node kinds / marker patterns needed

### Exit gate — `/gate-check 1`
Paper test passes; `npm run verify` green; ADR-001 closed or formally moot
(Path B).

---

## Stage 2 — One document, exceptionally well  `Path A: 5–7 wks · Path B: ~2 wks`

**Goal:** the purchase order renders correctly, reproducibly, and measurably —
and the spike gates become the permanent corpus.

### Tasks
- [ ] Corpus scaffold `test/corpus/purchase-order/001…007` from the seeded generator (single-page, two-page, ten-page, **120-line carry-forward**, **totals-at-boundary**, **overflow-must-fail**, empty-lines) — DoD: `npm test` runs corpus; remove `passWithNoTests`
- [ ] PDF normalization helper (zero CreationDate/ModDate + doc ID) shared by all snapshot tests — DoD: two consecutive renders byte-match after normalization
- [ ] Archive profile = **PDF/A-2b**, veraPDF joins the corpus gates (ADR-006); pdf-direct gains embedded TTF + XMP + OutputIntent if it stays in play — DoD: veraPDF clean on every corpus artifact in CI
- [ ] *Path A:* composition (measure → wrap → break; seed = spike greedy wrap) + nine components + chosen renderer behind `Renderer` — DoD: corpus green
- [ ] *Path B:* production PO template authored; Carbone behind `Renderer` (`office-template` job kind); LibreOffice version + fonts pinned in `Dockerfile` — DoD: corpus green in the pinned container
- [ ] Structural diff CLI (`bo-output diff`) — page count + box/text deltas, not pixels — DoD: intentional template change produces a readable diff in CI output *(doubles as the ADR-005 AI verifier)*
- [ ] Template-from-sample skill (`.claude/skills/template-from-sample/`) + **round-trip proof**: rasterize the corpus PO, hand the skill only the image, regenerate the template, diff converges — DoD: round-trip test green with zero real data
- [ ] ms/doc published in README, measured by the corpus bench — DoD: README table row

### Exit gate — `/gate-check 2`
Corpus green twice consecutively with identical normalized hashes; overflow
case fails loudly; ms/doc in README.

---

## Stage 3 — The wedge: determination + delivery  `~6–8 weeks · path-independent`

**Goal:** the part that exists nowhere else. This demo is the project's reason
to exist.

### Tasks
- [ ] `packages/runtime` created (its stage has begun) — ingress `POST /event` + contract validation — DoD: invalid payload → 400 with schema errors
- [ ] Standard API shapes (ADR-006): optional CloudEvents 1.0 envelope on `POST /event`; all errors as RFC 9457 problem+json incl. the rule TRACE — DoD: contract tests
- [ ] Rule evaluation with mandatory TRACE; non-match = error carrying the evaluated trace — DoD: test proves no silent no-op path exists
- [ ] Fan-out: one event → N resolutions (template, locale, channel, recipient) — DoD: bursting test = fan-out test
- [ ] Idempotency on `BusinessEventKey` — DoD: replayed event returns existing docId; **write this test first**
- [ ] Document registry (docId, object/id, template+renderer versions, input/output hashes, archiveRef, state, delivery history) — DoD: one row per artifact, migration in repo
- [ ] Archive store (FS + S3-compatible) with mandatory `retentionUntil` — DoD: archiving without retention fails
- [ ] Delivery queue: retry w/ backoff → terminal poison + alert; **never re-render on delivery failure** — DoD: test kills channel, artifact untouched, poison row present
- [ ] Channels: email + object-store only — DoD: both deliver the archived bytes
- [ ] Single-process `serve`: API + worker + embedded queue + FS archive — DoD: fresh clone → `serve` → end-to-end works with zero external services
- [ ] Embeddable module (ADR-007): `createOutput()` mounts in a host process sharing its Postgres; **transactional outbox** — DoD: rollback test shows no orphaned artifact or registry row
- [ ] Minimal console, read-only (UI-DESIGN): registry, document detail, rule trace as busy-office-ui pages — DoD: each passes the five UI principles; the Stage 3 demo runs through it
- [ ] **[HUMAN]** Thesis check: show the two-minute demo to 5 real operators — DoD: notes in `docs/PREMORTEM.md`; feeds C2
- [ ] ADR-003 (rule storage) + ADR-004 (queue) closed — DoD: Status: Accepted

### Exit gate — `/gate-check 3`
Event → rule trace → render → email → archived artifact → complete audit
trail, demonstrated end-to-end in under two minutes on the single-process build.

---

## Stage 4 — Second and third documents  `~5 weeks`

**Goal:** invoice and payslip, chosen because they break different things.

### Tasks
- [ ] Invoice: tax/multi-currency contract + template — DoD: corpus cases green
- [ ] **PDF attachment concatenation** (T&C append, cover sheet) — DoD: merged artifact archived as one document, page counts asserted
- [ ] Payslip: compact template + PII posture — DoD: corpus green; log-scrub test proves no payload fields in logs
- [ ] Author invoice + payslip templates via the template-from-sample skill on **redacted** real samples — DoD: templates carry `provenance: ai-generated`, corpus gates green; redaction step documented
- [ ] Document-level authorization: reproduce/regenerate/reissue evaluated against the document — DoD: HR-clerk vs employee test — same endpoint, different outcome
- [ ] Retention per doc type enforced end-to-end — DoD: expiry test purges artifact, registry row survives
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
