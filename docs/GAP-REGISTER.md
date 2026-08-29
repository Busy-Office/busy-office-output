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

### GAP-03 — ADR-002 stale: volume renderer decided on dead numbers
- Type: DECISION — **OPEN**
- ADR-002 still says "Pending real-hardware numbers"; they now exist
  (`README.md` bench table: Typst warm p50 ≈123ms → 8,000 docs ≈16.4 min
  single-process, inside the 30-min window at ~1.8x). ADR-001 already routed
  payslip-shaped docs to Typst; pdf-direct reaching PDF/A-2b is a
  fonts+XMP+OutputIntent workstream — gold-plating a renderer.
- Closes when: Stage 4 bursting gate run Typst-only through the real
  pipeline; ADR-002 Accepted on that measurement ("Typst-only, pdf-direct
  reserved-not-adopted" if it clears — the ADR-000 Carbone pattern).
- Owner: Claude measures, human decides. Blocks: Stage 4 exit gate.

### GAP-04 — Template authoring persona — **RATIFIED 2026-08-29**
- Type: DECISION
- Was: ADR-000 driver 2 left traceably unanswered.
- Decision: **implementing developer authors templates as code** (DocNode
  trees, as every shipped template was). AI-loop is Stage 7, trigger-gated,
  optional, never the primary persona. Visual builder stays deleted.
- Closed by: `ADRs/000-template-authoring-model.md` addendum 2026-08-29.

### GAP-05 — Licence: public repo, no LICENSE (ADR-008)
- Type: DECISION — **INTERIM-CLOSED 2026-08-29**, full close still human-only
- Repo is publicly clonable with no LICENSE file — default all-rights-
  reserved. ADR-008's "before any public release" trigger has arguably fired.
- Interim close condition met: README now states "No licence yet —
  evaluation only" explicitly. Full close still needs ADR-008 Accepted +
  LICENSE committed — a human-only decision (OSI licence choice, trademark).

### GAP-06 — Print scope vs the Deferred wall
- Type: DECISION — **OPEN, human-only**
- "Print out" listed as a need; the wall says print = PDF + OS spooler until
  a site that can't. Either name the site or restate as "PDF is the print
  path."
- Closes when: one sentence ratified either way; wall entry updated if a
  site is named.

## Seams

### GAP-07 — Consumer contract: five verbs, two exist
- Type: SEAM — **OPEN**, unblocked by GAP-01/02 (now decided)
- `emit` exists (OutputPort); `preview` named in HLD §4, never built;
  `status(businessKey)` missing; `reproduce(docId, channel)` has an
  AuthorizationPort but no callable operation (Stage 5);
  `registerDocumentType` missing entirely (→ GAP-08).
- Closes when: OutputPort v1 typed with all five verbs + contract tests;
  one consumer round-trips them.
- Note: with GAP-01 = standalone product, "one consumer" for the
  round-trip is this project's own `serve()`/console path, not an external
  ERP module.

### GAP-08 — Registration inversion: engine owns the document types
- Type: SEAM — **OPEN**
- Contracts, rules, and template content live inside the engine tree
  (`packages/schema/contracts/`, `packages/runtime/rules/`, hardcoded
  lookup in `render/template-content.ts`). No registration seam exists.
- Closes when: `registerDocumentType(contract, templates, rules)` seam
  exists and one document type registers from outside the engine tree,
  lint-enforced.
- Blocks: GAP-07 verb five.

### GAP-09 — Embedded topology leaks the typst binary into hosts
- Type: SEAM — **OPEN**
- T1 `createOutput()` drags the `typst` shell-out into every host process.
- Closes when: ratified default for hosts (T2 split worker, or renderer
  isolated behind a process seam) recorded in ADR-007 addendum + HLD §11.
- Note: lower priority under GAP-01 = standalone product (no active host).

### GAP-10 — Email is bytes-only: no message body templating
- Type: SEAM — **OPEN**
- EmailChannelSender delivers archived bytes; the expectation is a templated
  subject/body with the PDF attached. No task exists anywhere.
- Closes when: task defined with its own DoD + mini-decision on governance
  (lifecycle-governed vs channel config); built and tested.

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

## Gate

### GAP-13 — Thesis validated with N=0 operators
- Type: GATE — **OPEN, human-only**
- ~1.5 stages built past an open thesis check. Under GAP-01 = standalone
  product, the operator demo IS the validation (not "first consumer
  wired") — this gap is now unambiguously `GATE-S3-THESIS-CHECK`.
- Closes when: 5-operator demo done, `docs/PREMORTEM.md` written — or a
  ratified exception explicitly permits Stage 5 to proceed unvalidated.

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
