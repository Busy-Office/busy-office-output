# Session log

Newest first. One entry per Claude Code session. Template:

```
## YYYY-MM-DD — Stage N
- Did: <task> — evidence: <command → result>
- Open: <anything half-finished, or "nothing">
- Next: <recommended pickup>
```

---

## 2026-08-29 — gap register: GAP-11/12/03 closed (loop ticks 1–2)
- Did: maintainer-authored gap register (docs/GAP-REGISTER.md) ratified
  Session A in chat (GAP-01 -> ADR-009 standalone product; GAP-02 spine
  non-optional; GAP-04 developer-authors-as-code) and GAP-14 doc drift
  fixed. Then the loop (every 20 min) closed the three Claude-doable
  tasks: GAP-11 — server.ts onto the transactional outbox via a shared
  submit-resolution.ts (no third divergent copy), serve() startup resume
  sweep, HTTP-path crash-resume test with red/green proof. GAP-12 — CI
  red-to-green on the real runner (run 33229511242) with pinned typst
  0.15.1 + veraPDF 1.30.2 + poppler-utils, install sequence proven in an
  x86_64 Ubuntu container first. GAP-03 — 8,000 payslips MEASURED through
  the full real pipeline: 18.64 min, 139.8 ms/doc, 1.61x inside the
  30-min window single-process (render is 99% of cost); concurrency-4
  extrapolated 6.5 min.
- Open: ADR-002 (GAP-03's human half — measurement clears Typst-only,
  decision is the maintainer's), GAP-05 licence, GAP-06 print scope,
  GAP-09 host topology, GAP-13 thesis gate — all human-only. GAP-07/08
  (consumer contract + registration seam) and GAP-10 (email templating)
  need an arb-chair/decision before build. Template-from-sample on
  redacted samples still blocked on real samples.
- Next: nothing in Stage 4 is buildable without a decision now. The
  loop's next ticks will be noops until one of: ADR-002 decided (-> Stage
  4 exit gate run), GAP-07/08 ruled (-> consumer contract build), or
  GAP-10 decided (-> email templating build).

## 2026-08-29 — Stage 4: document-level authorization
- Did: arb-chair ruling — pure AuthorizationPort evaluator only (ADR-007's
  already-named boundary, first concrete shape), not the live reprint
  HTTP routes (Stage 5's job) and no console changes. hr-clerk allows any
  payslip; employee allows only their own (new owner_id registry column,
  migrations/0009, populated only for payslip mints via
  extractPayslipOwnerId); every other document type default-allows, no
  invented per-type policy. Wired into both mint call sites
  (embed/create-output.ts AND server.ts's actual serve() HTTP path) so
  it's not dead code in the primary runtime mode. Never logged —
  payslip-log-scrub.test.ts re-verified still passing with teeth intact.
- Open: template-from-sample on redacted samples (blocked, no real
  samples), bursting/second-renderer (ADR-002 still Proposed). Every
  fully-independent Stage 4 task is now done. Stage 3's
  GATE-S3-THESIS-CHECK remains open (human-only).
- Next: only ADR-002-blocked or missing-real-samples-blocked Stage 4
  tasks remain. Bursting/second-renderer needs ADR-002 (volume renderer
  routing) decided — same pattern as ADR-003/004/007 this session, worth
  asking the maintainer directly. Otherwise Stage 4's exit gate
  (8,000-recipient payroll run, ADR-002 closed) is the next real
  milestone once that's decided.

## 2026-08-28 — Stage 4: operations console page
- Did: console-designer ruled retry stays inert text (Stage 3 precedent,
  no DoD demanding live action). GET /output/operations — new
  DeliveryQueue.listJobs port method, worst-first sort, quiet-when-green
  default, recipient counts not addresses. Bidirectional cross-links
  between Registry/Document-detail and Operations on any poisoned
  delivery.
- Open: template-from-sample on redacted samples (blocked, no real
  samples), document-level authorization, bursting/second-renderer
  (ADR-002 still Proposed). Stage 3's GATE-S3-THESIS-CHECK remains open
  (human-only). Only ADR-002-blocked and no-real-samples-blocked tasks
  remain buildable-with-a-decision in Stage 4; document-level
  authorization is the only fully independent one left.
- Next: document-level authorization is the last clearly-buildable Stage
  4 task without a new decision; bursting/second-renderer needs ADR-002
  decided first (same pattern as ADR-003/004/007 this session).

## 2026-08-28 — Stage 4: retention per doc type, expiry enforcement
- Did: per-document-type retention policy (invoice 10y, payslip 6y,
  purchase-order 3y — non-legal defaults, documented as such). Real
  enforcement: ArchiveStore.purge() (idempotent), enforceRetention()
  purges bytes then marks the registry row (crash-safe ordering — never
  claims purged bytes that still exist), row survives forever with a
  legible purged signal (archiveRef null + purgedAt set, distinct from
  never-archived and still-archived). Directly callable, no new
  background loop — a future worker/cron task's job to wire.
- Open: template-from-sample on redacted samples (blocked, no real
  samples available), document-level authorization, bursting/second-
  renderer (ADR-002 still Proposed), operations console page. Stage 3's
  GATE-S3-THESIS-CHECK remains open (human-only).
- Next: document-level authorization or the operations console page are
  the two remaining independent Stage 4 tasks; bursting/second-renderer
  needs ADR-002 decided first.

## 2026-08-28 — Stage 4: PDF attachment concatenation
- Did: packages/render-typst/src/merge-pdf.ts (pdf-lib, new dependency,
  packages/schema untouched) — page-level concatenation (cover sheet +
  rendered document + T&C fixture), not ISO 19005-3 embedded-file
  attachment (deliberately deferred, Tier 3). Re-attaches PDF/A-2b
  OutputIntents/Metadata/trailer ID that pdf-lib's bare PDFDocument.create
  loses, verified against real verapdf not assumed.
  composeConcatenatedRenderArchiveAndEnqueue() added standalone,
  deliberately not wired into any document type's default render path —
  no per-template/per-rule trigger exists yet to decide when
  concatenation should apply automatically.
- Open: template-from-sample on redacted samples, document-level
  authorization, retention per doc type, bursting/second-renderer
  (ADR-002 still Proposed), operations console page. Stage 3's
  GATE-S3-THESIS-CHECK remains open (human-only).
- Next: wiring concatenation into a real document type's default flow
  (e.g. always-on for invoices, or a template-level flag) is a natural
  follow-up whenever a real trigger is decided — not blocking anything
  else. Document-level authorization or retention-per-doc-type are also
  independent next tasks.

## 2026-08-28 — Stage 4: payslip compact template + PII posture
- Did: payslip gets real render content (payslip-global-v1 DocNode,
  compact: identity block + earnings/deductions table + totals) — third
  and last Stage 1 document type; previously determination-only. test/
  corpus/payslip/: 4 cases (single-page, earnings/deductions mix,
  empty-lines, overflow-must-fail — no manufactured multi-page case,
  genuinely not needed for a compact template). Real DoD:
  payslip-log-scrub.test.ts drives a full payslip event through the real
  pipeline with console.log/error/warn intercepted, greps every captured
  line for the payload's own real PII values across a happy path AND a
  forced-poison path (the latter proves the capture mechanism actually
  intercepts real output via a genuine, non-mocked onPoisonAlert
  console.error line, so the test isn't vacuously passing on nothing).
  No pre-existing logging leak found.
- Open: PDF attachment concatenation, template-from-sample on redacted
  samples, document-level authorization, retention per doc type,
  bursting/second-renderer (ADR-002 still Proposed), operations console
  page. Stage 3's GATE-S3-THESIS-CHECK remains open (human-only).
- Next: document-level authorization (reproduce/regenerate/reissue
  evaluated per-document, HR-clerk vs employee test) is a natural next
  task now that a real payslip exists to authorize access to. PDF
  attachment concatenation is independent and could go first instead.

## 2026-08-28 — Stage 4: invoice contract + template + corpus
- Did: first Stage 4 task. Invoice gets real render content
  (invoice-global-v1 DocNode tree, reused from the Stage 1 paper-test
  fixture) — previously determination-only. test/corpus/invoice/: 5
  cases mirroring purchase-order's structure (single-currency, multi-page
  carry-forward, tax-rate variation incl. a zero-rated line, overflow-
  must-fail, empty-lines). Multi-currency scope decision: schema
  untouched, header currency + Money's per-instance currency already
  cover any single-currency invoice; mixed-currency-per-line deliberately
  deferred (no consumer needs it, avoids gold-plating the contract).
  Confirmed packages/render-typst is genuinely document-type-agnostic —
  zero renderer changes needed for the second document type.
- Open: PDF attachment concatenation, payslip + PII posture, template-
  from-sample on redacted samples, document-level authorization,
  retention per doc type, bursting/second-renderer (ADR-002 still
  Proposed), operations console page. Stage 3's GATE-S3-THESIS-CHECK
  remains open (human-only, doesn't block Stage 4).
- Next: payslip (PII posture) is the natural next document-type task —
  it's the one that actually needs the payslip x-pii schema marker and
  the "no payload fields in logs" log-scrub test to mean something, since
  no payslip has ever been rendered yet.

## 2026-08-28 — Stage 3 exit gate verified PASS (machine-checkable criteria)
- Did: a second, independent corpus-qa gate-check (real commands, fresh
  /tmp state) confirmed the Stage 3 exit gate: POST /event on a real
  purchase-order -> 0.157s response with a matched rule trace; real
  PDF/A-2b archived on disk; delivery byte-identical to the archived
  artifact ~3s later; registry state ORIGINAL; delivery_history
  'delivered'; all three console routes return real HTML for the docId.
  177/177 tests, typecheck clean. Also demonstrated live in-session
  (twice: locally and inside a fresh podman container built from a new
  Dockerfile) with screenshots sent to the maintainer — the exit gate
  isn't just test-asserted, it's been watched working.
  Added GATE-S3-THESIS-CHECK to docs/HUMAN-GATES-LOG.md (corpus-qa
  flagged this was the one human-blocking item not logged there like
  every other one). Maintainer also asked to reduce approval-asks:
  CLAUDE.md now pre-authorizes brew install for the established
  GATE-*-INSTALL pattern (bounded: local dev-tool binaries only, still
  logged, nothing scripted/sudo/other-package-managers) — everything else
  this session (dozens of build tasks, several arb-chair rulings) already
  ran without asking; only 4 things ever needed the maintainer's input
  (ADR-003/004/007, the verapdf install).
- Open: Stage 3 is not fully closed — GATE-S3-THESIS-CHECK
  (docs/HUMAN-GATES-LOG.md, open) is the one remaining task, genuinely
  human-only: show the demo to 5 real operators, write up
  docs/PREMORTEM.md. Every other Stage 3 task and this exit gate's own
  machine-checkable criteria are done.
- Next: Stage 4 ("Second and third documents") is buildable in parallel
  with the maintainer doing the thesis check whenever convenient — read
  ROADMAP.md's Stage 4 section before starting. GATE-S3-THESIS-CHECK
  doesn't block Stage 4's own tasks the way it blocks Stage 3's own
  literal closure.

## 2026-08-28 — Stage 3: embeddable module (createOutput + outbox)
- Did: ADR-007 accepted directly by the maintainer in chat (recommendation
  adopted as drafted). arb-chair scope ruling: no PostgresRegistryStore
  (no live Postgres available), no ADR-007 package restructuring,
  createOutput() built over existing injected ports only. Closed the real
  crash-mid-composition gap flagged in the prior session: mintWithOutbox
  wraps docId mint + a new composition_outbox row in one SQLite
  transaction (migrations/0005_add_composition_outbox.sql);
  resumeStrandedCompositions() redrives unfinished work, skipping any
  docId whose archive already succeeded (no orphaned second copy).
  Rollback tests (real TypstRenderer, real on-disk SQLite/FS archive)
  prove the DoD directly: exactly one archived artifact, registry row
  reaches ORIGINAL, idempotent on a second resume.
- Open: minimal console, [HUMAN] thesis check (permanently open — needs
  the maintainer). Flagged, not fixed: server.ts's HTTP ingress still
  uses the pre-outbox mint path, so the same crash window exists there;
  createOutput() is fixed, the standalone HTTP demo path is not yet.
- Next: minimal read-only console (registry, document detail, rule trace
  pages) is the last buildable Stage 3 task — after that, only the
  human-only thesis check remains.

## 2026-08-28 — Stage 3: single-process serve
- Did: composition.ts (render+archive+enqueue per resolution, never
  throws; 10-year default retentionUntil documented as a Stage-3 stand-in,
  not Stage 4's real per-doc-type policy), render/template-content.ts (one
  hardcoded `po-global-v1` -> DocNode lookup per arb-chair ruling —
  invoice/payslip resolve through determination but surface an honest
  `no-template-content` outcome, never a crash or fabricated artifact),
  delivery/fs-channel-sender.ts (FsChannelSender, the zero-external-
  services ChannelSender default — writes ./data/outbox/<channel>/
  <docId>-<uuid>.bin + JSON sidecar), worker.ts (`drainOnce` — timer-free,
  deterministic drain the e2e test calls directly; `startWorker` — thin
  overlap-safe setInterval wrapper for real `serve()` runs), index.ts
  (`createRuntimeDeps` assembles SQLite registry + FsArchiveStore +
  SqliteDeliveryQueue + TypstRenderer + FsChannelSender; `serve()` wires
  ingress + composition + worker into one function — CLAUDE.md's "API +
  worker + embedded queue + FS archive in one command" is now true, not
  aspirational). e2e.test.ts drives a real HTTP POST through
  `createIngressServer` with real `typst compile` (no mocks on the
  render/archive/delivery path) — evidence: rule trace present, PDF bytes
  actually rendered and archived (`countPdfPages` >= 1), FsChannelSender
  outbox file byte-identical to the archived artifact, registry
  DRAFT->ORIGINAL with delivery_history recording the attempt; a second
  test proves the invoice no-content path never fabricates a row. `npm run
  verify`: 159/159 tests, 6.18s wall-clock.
- Open: embeddable module + transactional outbox (ADR-007), minimal
  console, [HUMAN] thesis check (permanently open). One flagged edge case,
  out of this task's scope: if a process crashes between minting a docId
  and finishing composition, a later replay of that same event is seen as
  `replayed: true` and skips composition again — nothing retries the
  stranded render/archive/enqueue. Left as-is; likely an ADR-007
  (transactional outbox) concern, not an idempotency-semantics patch.
- Next: embeddable module + transactional outbox (ADR-007) — the crash-
  mid-composition gap above is exactly what that task's rollback
  guarantees need to cover.

## 2026-08-28 — Stage 3: channels (email + object-store)
- Did: EmailChannelSender (nodemailer) and ObjectStoreChannelSender
  (@aws-sdk/client-s3) both implement the ChannelSender port, wired via a
  ChannelRouter that dispatches on the resolution's channel string and
  throws (never silently no-ops) on an unrecognized channel. Both
  mock-tested only, no live SMTP/S3. Object-store delivery writes to a
  distinct location from the archive store (structural separation only,
  not runtime-enforced).
- Open: single-process serve, embeddable module + outbox, minimal
  console, [HUMAN] thesis check (permanently open).
- Next: single-process serve — wires ingress + determination +
  idempotency + registry + archive + delivery queue + channels into one
  `serve` command, the last piece needed to actually run the Stage 3 exit
  gate's end-to-end demo.

## 2026-08-28 — Stage 3: delivery queue (retry/backoff/poison)
- Did: packages/runtime/src/delivery/ — DeliveryQueue port + SqliteDeliveryQueue
  (ADR-004, SQLite-backed embedded), migrations/0004_add_delivery_queue.sql,
  exponential backoff capped (default 5 attempts). Core guarantee proven
  directly by test: kill the channel via a fake ChannelSender, drive to
  poison, confirm delivery_history has one row per attempt and
  ArchiveStore.retrieve returns byte-identical bytes before/after every
  attempt — delivery failure never re-renders, never re-archives. Real
  channels are the next task; this task's sender is fake/injectable only.
- Open: channels (email + object-store), single-process serve, embeddable
  module + outbox, minimal console, [HUMAN] thesis check (permanently
  open — needs the maintainer).
- Next: channels is the natural next task — it gives DeliveryQueue a real
  ChannelSender implementation instead of the test fake.

## 2026-08-28 — Stage 3: fan-out (one event → N resolutions)
- Did: determine() now returns resolutions: Resolution[] (>=1). Rule
  co-firing is opt-in (OutputRule.fanOut, default false) — non-fan-out
  rules still compete winner-take-all, every matched fanOut:true rule
  fires additionally. Atomic on template-lookup failure (no partial fan-out
  set). Idempotency key widened to (four-tuple + ruleId) via
  ResolutionEventKey/getOrCreateByResolutionKey, migration
  0003_add_rule_id_to_registry.sql — N resolutions from one event mint N
  stable docIds on replay, never 2N. fanout.test.ts proves 3 rules -> 3
  resolutions -> 3 stable docIds.
- Open: delivery queue, channels (email + object-store), single-process
  serve, embeddable module + outbox, minimal console, [HUMAN] thesis check
  (stays open regardless — genuinely needs the maintainer to show the demo
  to 5 real operators).
- Next: delivery queue is the natural next task — it consumes
  resolutions'/registry's channel+recipients+archiveRef and is now
  unblocked by ADR-004 (SQLite-backed embedded, accepted this session).

## 2026-08-28 — Stage 3: ADR-003/004 accepted, determination + TRACE
- Did: goal set to "complete Stage 3". ADR-003 (rule storage) and ADR-004
  (queue backend) were both blocking remaining tasks — drafted
  recommendations and got the maintainer's direct decision in chat:
  ADR-003 Option 1 (files first), ADR-004 Option 1 (SQLite-backed embedded
  queue — the registry's own SQLite choice resolved ADR-004's stated
  Postgres-conditional leaning). Then built: CloudEvents 1.0 envelope
  support on POST /event (optional, raw payloads unaffected) and rule
  evaluation with mandatory TRACE (packages/runtime/src/determination/) —
  files-first OutputRules matched against the event, reusing Stage 1's
  resolveTemplate as the sole authoritative template-resolution winner.
  TRACE is mandatory on every call (match or no-match), no-rule-match/
  no-template-match are 422 problem+json carrying the full trace,
  determination runs before idempotency so a no-match event never mints
  a docId.
- Open: fan-out (one event -> N resolutions), delivery queue, channels
  (email + object-store), single-process serve, embeddable module +
  outbox, minimal console, [HUMAN] thesis check (genuinely human-only —
  showing the demo to 5 real operators is not something this session can
  do; will stay open regardless of how far Stage 3 otherwise gets).
- Next: fan-out builds directly on today's determination work (N
  resolutions instead of one) — natural next task.

## 2026-08-27 — Stage 3: archive store (FsArchiveStore + S3ArchiveStore)
- Did: packages/runtime/src/archive/ — ArchiveStore port (archive/
  retrieve), retentionUntil required at the type level and runtime-
  validated (RFC 3339) before any byte is written. FsArchiveStore is the
  default embedded backend under ./data/ (matches single-process serve's
  "zero external services"); S3ArchiveStore is S3-compatible via
  @aws-sdk/client-s3, mock-tested only (no live S3/MinIO in this
  environment — flagged, not hidden). archiveArtifact() wires archive to
  the registry: bytes written, then archiveRef+retentionUntil set, then
  DRAFT->ORIGINAL — in that order, so a failed archive never leaves a
  dangling registry row. New migration 0002_add_retention_until.sql.
- Open: rest of Stage 3 — CloudEvents envelope, rule evaluation + TRACE
  (blocked on ADR-003), fan-out, delivery queue (blocked on ADR-004),
  channels, single-process serve, embeddable module + outbox, minimal
  console, human thesis check.
- Next: with registry + archive both done, "single-process serve" (API +
  worker + embedded queue + FS archive, fresh clone -> zero external
  services) is close to reachable but needs at least a minimal
  determination/render wiring path to be a real end-to-end demo — likely
  needs an arb-chair scoping call on how much of "determination" a
  pre-ADR-003 demo can honestly claim. Channels/delivery queue still wait
  on ADR-004; rule evaluation/fan-out still wait on ADR-003.

## 2026-08-27 — Stage 3: document registry (RegistryStore + SQLite)
- Did: arb-chair ruling first (this task's storage choice touches ADR-004,
  still Proposed, whose own text conditions on "if the registry lands on
  Postgres anyway") — ruled proceed behind a RegistryStore port with a
  default node:sqlite implementation, not Postgres, so ADR-004 isn't
  silently pre-decided; a PostgresRegistryStore stays available later
  behind the same port. Then built packages/runtime/src/registry/: real
  versioned migrations (migrations/0001_init.sql + schema_migrations
  tracking), document_registry (one row per artifact: docId, business
  object/id, template+renderer versions, input/output hashes, archiveRef
  pointer, state — DRAFT on mint) with a UNIQUE index on the idempotency
  four-tuple, append-only delivery_history child table. Replaced
  idempotency-store.ts's in-memory Map (not extended — replaced, as its
  own header comment promised) with a facade over the registry; docId now
  survives a process restart, proven by a dedicated test.
- Open: rest of Stage 3 — CloudEvents envelope, rule evaluation + TRACE
  (blocked on ADR-003), fan-out, archive store (writes archiveRef's actual
  bytes + retentionUntil — the registry only holds the pointer), delivery
  queue (blocked on ADR-004), channels, single-process serve, embeddable
  module + outbox, minimal console, human thesis check.
- Next: archive store is the natural following task — it's ADR-independent
  and directly consumes the registry's archiveRef pointer field. Delivery
  queue/channels still wait on ADR-004; rule evaluation/fan-out still wait
  on ADR-003.

## 2026-08-27 — Stage 3: idempotency on BusinessEventKey
- Did: test-first (RED confirmed before GREEN, two vertical slices).
  packages/runtime/src/idempotency-store.ts — in-memory stand-in Map
  keyed on the canonical (businessObject, businessObjectId, event,
  templateVersion) four-tuple, explicitly documented as replaced wholesale
  by the later Document registry task, not extended in place.
  BusinessEventKey travels as a top-level `businessEvent` envelope field
  sibling to the contract payload (chosen to match the shape the future
  CloudEvents envelope task will need). Response: 202+replayed:false on
  first sighting, 200+replayed:true + same docId on replay.
- Open: rest of Stage 3 — CloudEvents envelope, rule evaluation + TRACE
  (blocked on ADR-003), fan-out, document registry (will replace this
  session's idempotency store), archive store, delivery queue (blocked on
  ADR-004), channels, single-process serve, embeddable module + outbox,
  minimal console, human thesis check.
- Next: document registry is the natural following task now that
  idempotency's contract is proven — it's ADR-independent and directly
  supersedes idempotency-store.ts. Rule evaluation/fan-out and the delivery
  queue stay blocked until ADR-003/ADR-004 are decided.

## 2026-08-27 — Stage 3 started: packages/runtime ingress
- Did: first Stage 3 task. New packages/runtime: POST /event on plain
  node:http, ajv 2020-12 + ajv-formats validation against
  packages/schema/contracts/*.schema.json (source of truth, not the TS
  aliases), RFC 9457 problem+json error shapes. Size-bounded body reads,
  no payload/stack leakage in any error path. ajv stays a
  packages/runtime-only dependency — packages/schema unaffected, still
  zero-runtime-dependency.
- Open: rest of Stage 3 — standard API shapes (CloudEvents envelope),
  rule evaluation + TRACE (blocked on ADR-003 rule-storage decision),
  fan-out, idempotency, document registry, archive store, delivery queue
  (blocked on ADR-004 queue-backend decision), channels, single-process
  serve, embeddable module + outbox, minimal console, human thesis check.
- Next: next Stage 3 task not yet chosen — ADR-003/ADR-004 remain
  Proposed and gate several of the tasks above; the maintainer should
  decide whether to prepare those ADR decisions next or pick another
  ADR-independent task (e.g. idempotency, which the roadmap explicitly
  flags "write this test first").

## 2026-08-27 — Stage 2 CLOSED (exit gate passed)
- Did: all seven Stage 2 tasks built and independently verified.
  New package `@busy-office/render-typst`: TypstRenderer implements
  `Renderer` (id: 'typst'), evaluates the frozen DocNode tree's
  expressions against real PurchaseOrderData, emits Typst markup for all
  nine node kinds incl. state()-based carry-forward footer, shells out to
  `typst compile --pdf-standard a-2b`. LayoutIR closed its DRAFT status
  per ADR-001 (now { irVersion, root: DocNode, data }, no page-resolved
  boxes — Typst owns pagination). Corpus: test/corpus/purchase-order/
  001-007, deterministic seeded generator, 67/67 tests green;
  overflow-must-fail (006) throws TypstOverflowError via a measure()-based
  guard after discovering Typst's table() silently clips rows that don't
  fit (a real gap the naive cursor-position guard missed). PDF
  normalization zeros CreationDate/ModDate/trailer-ID and Typst's XMP
  metadata (found: xmp:ModifyDate, xmpMM:InstanceID/DocumentID, and later
  xmpMM:History from the --pdf-standard flag) — folded into CLAUDE.md.
  Structural diff CLI (`bo-output diff`, shells to `pdftotext -bbox-layout`)
  doubles as the ADR-005 AI verifier. Template-from-sample skill
  (.claude/skills/template-from-sample/) with a round-trip proof — honestly
  scoped: proves rasterization + diff-convergence checking work, not that
  a vision-only agent independently derives the tree from pixels. ms/doc
  published in README (typst/purchase-order, p50≈123ms p95≈136ms,
  MacBook Air M4). PDF/A-2b + veraPDF: GATE-VERAPDF-INSTALL logged, the
  maintainer authorized `brew install verapdf` directly in chat, installed,
  wired into the corpus gate as part of `npm test` — 144/144 veraPDF rules
  pass, check proven to have teeth (unflagged Typst output genuinely fails
  validation). Every task independently re-verified by two separate
  corpus-qa gate-checks (real commands, fresh renders, not self-asserted).
- Open: nothing Stage-2-blocking. Stage 3 not yet started.
- Next: Stage 3 ("The wedge: determination + delivery") — read
  ROADMAP.md's Stage 3 section for its task list before starting.

## 2026-08-27 — Stage 1 CLOSED (exit gate passed)
- Did: GATE-S1-PREWORK answered directly in chat by the maintainer ("yes,
  start Stage 1"), logged to docs/INBOX.md, arb-chair ruling applied
  (GATE-S1-PREWORK closed; Path B Stage 1 task marked N/A per ADR-000's
  "do not build both speculatively" clause). Then built all six Stage 1
  tasks: data contracts (packages/schema/contracts/, 3 doc types + common
  definitions + RENAME-POLICY.md), variant resolution spec + resolver +
  13 tests (docs/VARIANT-RESOLUTION.md, packages/schema/src/variant/),
  reproduction policy (docs/POLICY.md, referenced from CLAUDE.md), Tier 1
  standards enforced in the contract schemas, node kinds un-drafted to
  FROZEN, expression grammar + allowlist parser + tests
  (docs/EXPRESSION-GRAMMAR.md, packages/schema/src/expression/), and the
  paper test (PO + invoice DocNode trees, packages/schema/src/document/
  paper-test.test.ts, docs/PAPER-TEST.md) — PASS, zero new node kinds or
  expression syntax needed. Exit gate independently verified by a
  corpus-qa gate-check (real commands, not self-asserted): paper test
  4/4, npm run verify 30/30 tests + clean typecheck, ADR-001 confirmed
  Accepted. ROADMAP.md Stage 1 exit gate marked 3/3 PASS.
- Open: nothing Stage-1-blocking. Stage 2 not yet started.
- Next: Stage 2 (rendering IR + renderer implementation) — read
  ROADMAP.md's Stage 2 section for its task list before starting.

## 2026-08-27 — build-loop tick 25 (noop, goal="complete Stage 1")
- Did: session goal set to "complete Stage 1". Checked docs/INBOX.md — Open
  still empty. GATE-S1-PREWORK still `open`, default NO. Per CLAUDE.md
  ("only the human decides") and build-loop's own rule ("never self-approve
  a gate"), the loop cannot open Stage 1 work on its own — this is a hard
  human-only decision point, not a stalled search for work.
- Open: GATE-S1-PREWORK — the single blocker on the "complete Stage 1" goal.
- Next: goal stays unmet until the maintainer answers GATE-S1-PREWORK in
  docs/INBOX.md (e.g. "GATE-S1-PREWORK: yes, start Stage 1"). Next
  dispatcher tick is 28.

## 2026-08-27 — build-loop tick 24 (dispatcher, noop)
- Did: dispatcher tick — docs/INBOX.md Open section still empty, nothing to
  process. GATE-S1-PREWORK still `open`, default NO. No change since tick 23.
- Open: GATE-S1-PREWORK.
- Next: human answers GATE-S1-PREWORK, or drops an item in docs/INBOX.md
  for the next dispatcher tick (tick 28).

## 2026-08-27 — build-loop tick 23 (noop)
- Did: checked docs/INBOX.md — Open section still empty. GATE-S1-PREWORK
  still `open`, default NO. No change since tick 22.
- Open: GATE-S1-PREWORK.
- Next: dispatcher tick (24) next — will only act if the human has dropped
  an answer in docs/INBOX.md by then.

## 2026-08-27 — build-loop tick 22 (noop)
- Did: checked docs/INBOX.md — Open section still empty. GATE-S1-PREWORK
  still `open`, default NO. No change since tick 21.
- Open: GATE-S1-PREWORK.
- Next: human answers GATE-S1-PREWORK, or drops an item in docs/INBOX.md
  for the next dispatcher tick (tick 24).

## 2026-08-27 — build-loop tick 21 (noop)
- Did: checked ROADMAP.md / docs/HUMAN-GATES-LOG.md / docs/INBOX.md — all
  unchanged since tick 20. GATE-S1-PREWORK still `open`, default NO.
- Open: GATE-S1-PREWORK.
- Next: human answers GATE-S1-PREWORK, or drops an item in docs/INBOX.md
  for the next dispatcher tick (tick 24).

## 2026-08-27 — build-loop tick 20 (dispatcher, noop)
- Did: dispatcher tick — checked docs/INBOX.md Open section: empty, nothing
  to process. Stage 0 remains closed; Stage 1 remains blocked —
  GATE-S1-PREWORK still `open`, default NO.
- Open: GATE-S1-PREWORK (needs maintainer answer in docs/INBOX.md).
- Next: same — human answers GATE-S1-PREWORK, or drops an item in
  docs/INBOX.md for the next dispatcher tick (tick 24).

## 2026-08-27 — build-loop tick 19 (noop)
- Did: read ROADMAP.md, docs/HUMAN-GATES-LOG.md, docs/INBOX.md. INBOX Open
  section empty (nothing for dispatcher). Stage 0 remains closed; Stage 1
  remains blocked — GATE-S1-PREWORK still `open`, default NO.
- Open: GATE-S1-PREWORK (needs maintainer answer in docs/INBOX.md).
- Next: same as tick 18 — human answers GATE-S1-PREWORK, or drops a new
  item in docs/INBOX.md for the next dispatcher tick (tick 20).

## 2026-08-27 — Stage 0 CLOSED (exit gate passed, spike/ deleted)
- Did: ran `/gate-check 0` via corpus-qa (read-only pass): 3/4 exit-gate
  criteria PASS (ADR-000 evidenced, ms/doc measured warm, bursting math
  closes), 1 FAIL (spike/ not yet deleted). Applied the fix: moved
  `spike/RESULTS.md` → `docs/RESULTS.md` (git mv, preserves history),
  deleted the rest of `spike/` (`bench.js`, `carbone/`, `data/`,
  `pdf-direct/`, `typst/`, `README.md` — all disposable by
  `spike/README.md`'s own stated policy). Cleaned up what the deletion
  broke rather than leaving it half-done: removed the now-dead `spike:*`
  scripts from `package.json`; updated `CLAUDE.md`'s Commands section,
  its stale "ADR-000 is open" golden rule (now factually wrong — fixed to
  cite the real gate, GATE-S1-PREWORK, that governs early Stage 1 work),
  and its status line; updated `README.md`'s "Start here" list and status
  blurb (was still "pre-Stage-0" with a broken `spike/README.md` link);
  repointed `spike/RESULTS.md` citations to `docs/RESULTS.md` in
  ADRs/000, 001, 002. Left historical log entries (SESSION-LOG,
  HUMAN-GATES-LOG prior rows) untouched — those correctly describe what
  was true when written. `npm run verify` green throughout.
  ROADMAP.md's exit-gate block now shows all 4 PASS with citations; Stage
  0 heading marked CLOSED 2026-08-27.
- Open: `GATE-S1-PREWORK` still open (default NO) — Stage 1 has not
  formally started. `.claude/agents/render-engineer.md`,
  `.claude/agents/corpus-qa.md`, and `.claude/skills/build-loop/SKILL.md`
  still reference the now-deleted `spike/` paths/status — left as-is,
  lower-priority documentation drift, not load-bearing for any command or
  gate.
- Next: Stage 1 work (contracts, variant resolver, Tier-1 codes) once
  `GATE-S1-PREWORK` is answered, or ADR-002's routing rule (pdf-direct vs
  Typst by document type/locale) — either is a live path now.

## 2026-08-27 — Stage 0 (GATE-BURST-WINDOW closed)
- Did: maintainer decided the bursting window: **30 minutes** for 8,000
  docs. Chosen as the point where both renderers clear single-process
  with no worker-pool fan-out: pdf-direct 18.6x margin, Typst (cold,
  single-process) 2.25x margin — and Typst's margin was the deciding
  constraint given ADR-001 routes multi-page/carry-forward/non-Latin
  documents (a real batch's likely shape) to Typst, not just pdf-direct's
  fast path. Applied: docs/HUMAN-GATES-LOG.md GATE-BURST-WINDOW closed;
  spike/RESULTS.md bursting section filled with the decided window +
  achieved line; ROADMAP.md bursting-math checkbox ticked. While filling
  this in, caught and corrected a pre-existing arithmetic error in
  RESULTS.md: prose claimed Typst "clears the 5/15-min windows at 3x/9x
  margin," which doesn't reconcile with the required-ms/doc table
  (recomputed: Typst does NOT clear 5-min single-process, clears 15-min
  at only ~1.1x, clears 30-min at 2.25x — matches only the 30-min figure
  the original prose already had right). Corrected inline with a note;
  not load-bearing for the 30-min decision since that number was already
  right. `npm run verify` green.
- Open: GATE-S1-PREWORK still open. `spike/` deletion still blocked —
  need to re-check the Stage 0 exit gate (`/gate-check 0`) now that
  ADR-000, ADR-001, and GATE-BURST-WINDOW are all closed.
- Next: run `/gate-check 0` to see what (if anything) still blocks Stage
  0's exit; if clean, `spike/` deletion + RESULTS.md → docs/ move is the
  last Stage 0 task.

## 2026-08-27 — Stage 0/1 (ADR-001 decided)
- Did: ran a deep-research workflow surveying the FOSS document-templating
  landscape (Carbone, Typst, pdf-lib, and alternatives) to inform ADR-001.
  Workflow's final synthesis stage returned broken placeholder output
  (bug, feedback filed); manually re-derived the real findings from the
  run's journal (107 agents, 86 claims extracted, 25 adversarially
  verified, 17 confirmed/8 killed). No new FOSS option surfaced beyond
  what Stage 0 already evaluated. Key finding: Typst's pagination is
  renderer-side/automatic with a "regions" layout model giving exact
  positional info during layout (unlike TeX's decoupled
  linebreak-then-pagebreak) — the architectural crux of ADR-001.
  Maintainer decided ADR-001: **Option 2 (renderer-side/Typst), scoped by
  document type — not forced cross-renderer parity.** Typst owns
  pagination for multi-page/carry-forward/non-Latin documents;
  pdf-direct stays available for simple high-volume bursts on
  throughput grounds (12.1ms vs 100ms). Retires the original
  `test/conformance/` cross-renderer page-break-identity goal as a
  global guarantee — named as a deliberate trade-off, not hidden.
  Applied: ADRs/001-pagination-location.md Status → Accepted, Decision
  section written with reasoning + named risk (can't cheaply route one
  document type to either renderer interchangeably later without
  revisiting). ADRs/README.md status table updated; ADR-002 noted as
  inheriting the document-type-scoped-split framing. `npm run verify`
  green.
- Open: ADR-002 (volume renderer) still Proposed — now needs to decide
  the concrete document-type/locale routing rule between pdf-direct and
  Typst, per ADR-001's framing. GATE-BURST-WINDOW, GATE-S1-PREWORK still
  open. `spike/` deletion still blocked on Stage 0 exit gate (bursting
  window undecided).
- Next: either GATE-BURST-WINDOW (maintainer picks the bursting window)
  or start on ADR-002's routing rule — both are live paths forward now.

## 2026-08-26 — Stage 0 (loop tick 12, dispatcher: checkbox reconciliation)
- Did: dispatcher pass. INBOX Open empty, no gates newly answered — but
  flagged-last-session stale checkboxes were real. corpus-qa verified
  spike/RESULTS.md against ROADMAP.md:36/37/39: hardware re-run (line 36)
  and RTL/CJK smoke test (line 37) both have genuine target-hardware
  evidence already recorded (from loop Q2/Q3/Q5) — ticked both with
  inline citations. Bursting math (line 39) correctly stays unticked:
  GATE-BURST-WINDOW is genuinely still open, RESULTS.md has a
  parametrized 4-window table, not the single decided window the DoD
  names. arb-chair then ruled on a second flag: the Stage 0 exit gate
  (ROADMAP.md:45) said "all four decision drivers answered from
  measurements," but ADR-000 (now Accepted) has 5 drivers and only 1 is
  purely measurement-based. Updated exit-gate item 1 to match what was
  actually accepted (evidenced — measured, explicitly skipped, or
  ADR-sourced — not silently missing) without going toothless. Item 3
  (bursting window) left as-is — correctly still blocking. `npm run
  verify` green.
- Open: GATE-BURST-WINDOW, GATE-S1-PREWORK still open. ADR-001
  (pagination location) still needs deciding — live per ADR-000's
  practical consequence. `spike/` deletion (ROADMAP.md last task) still
  blocked on ADR-000/001 both being fully settled per the exit gate.
- Next: ADR-001 decision (maintainer), or the exit-gate re-check via
  `/gate-check 0` once bursting window is decided.

## 2026-08-26 — Stage 0 (ADR-000 decided)
- Did: maintainer decided ADR-000: **Option C (hybrid), scoped narrowly.**
  Clarified first (the draft's Option C text said "Carbone as renderer #1,
  fast to market," in tension with the skip-carbone decision) — confirmed
  the intent is: schema-first (Option A: Typst/pdf-direct) is the only
  renderer built now; Carbone/Path B is reserved behind the `Renderer`
  seam per Option C's architecture but not adopted, not built, not
  benchmarked — revisit only if a named user needs .odt/.docx authoring.
  Applied: ADRs/000-template-authoring-model.md Status → Accepted,
  Decision section rewritten from draft-recommendation to actual decision
  with the practical consequence spelled out. ADRs/README.md status table
  updated (000 Accepted; 001 now marked live/not-moot, since schema-first
  is the active path). ROADMAP.md:41 ticked with the decision summary.
  `npm run verify` green.
- Open: **ADR-001 (pagination location) is now live** — composition-side
  vs. renderer-side vs. hybrid, must be decided before Stage 1 locks
  contracts. ADR-002 (Typst vs. pdf-direct vs. both as volume renderer)
  also still open, informed by the RTL/CJK findings. Stage 0 exit gate
  (ROADMAP.md:44-48) not yet fully clear: line 45 says "all four decision
  drivers" but ADR-000 has 5 — pre-existing miscount in the roadmap text,
  not introduced this session, worth a small fix later. Bursting math and
  RTL/CJK ROADMAP checkboxes still look like stale duplicates of completed
  Q3/Q4 loop work (flagged last session, still not reconciled).
- Next: decide ADR-001 (pagination location) — present the three options
  (composition-side / renderer-side / hybrid) to the maintainer. Then
  Stage 0's remaining items: reconcile the stale RTL/CJK + bursting math
  checkboxes against actual Q3/Q4 evidence, re-run benches DoD note
  (ROADMAP.md:36 may also already be satisfied by loop tick 2/5 — same
  reconciliation), then `spike/` deletion + `/gate-check 0`.

## 2026-08-26 — Stage 0 (ROADMAP.md:40 ruling)
- Did: `/next` proposed getting an arb-chair ruling on whether
  ROADMAP.md:40 ("`/adr 000` round-table draft... decision drivers all
  evidenced") is satisfied by the ADR-000 draft, given drivers 2-4 are
  explicitly marked unanswered/unanswered-by-choice rather than measured.
  Ruling: **tick it** — "evidenced" ≠ "answered positively"; drivers 2-4
  are traceably documented as deliberately unanswered (cited to
  docs/INBOX.md, ROADMAP.md, ADRs/README.md), not fabricated or silently
  missing, which is what the DoD's document-completeness standard
  requires (no command can verify this DoD; two prior skeptic passes +
  this arb-chair review are the verification). ROADMAP.md:40 ticked with
  the ruling summary inline. No other ROADMAP.md text changes: line 41
  ([HUMAN] Decide ADR-000) stays unchecked, the Stage 0 exit gate (lines
  44-51) is unaffected and still fails criterion 1 until the maintainer
  actually decides ADR-000.
- Open: nothing from this task. Stage 0 exit gate still open (ADR-000
  undecided, hardware re-run and RTL/CJK-in-two-candidates and bursting
  math roadmap lines still unchecked — though RTL/CJK and bursting math
  were substantively done under the loop's Q3/Q4 work; those checkbox
  wordings may be stale duplicates of loop-queue items and worth a
  dispatcher pass to reconcile, not done here).
- Next: Stage 0's only remaining unblocked-in-principle roadmap lines are
  either [HUMAN]-only (hardware re-run, decide ADR-000) or look like
  stale restatements of already-completed loop work (RTL/CJK smoke test,
  bursting math — both done under Q3/Q4, see loop tick 3/4 entries below,
  but their ROADMAP.md checkboxes were never ticked). Worth reconciling
  those checkboxes against the loop's actual work next, or otherwise
  Stage 0 is human-blocked on ADR-000 itself.

## 2026-08-26 — Stage 0 (loop tick 10, dispatcher + Q6)
- Did: dispatcher pass (interactive — maintainer answered GATE-CARBONE
  in-session, processed immediately rather than waiting for tick%4).
  Maintainer decided "skip carbone": LibreOffice-as-production-dependency
  conflicts with "never gold-plate a renderer"; CCL license left unread as
  moot. GATE-CARBONE closed (not benchmarked, skipped by decision) —
  docs/HUMAN-GATES-LOG.md. ROADMAP.md carbone-author + CCL-read [HUMAN]
  tasks annotated SKIPPED (left unchecked, no DoD ran). docs/INBOX.md item
  moved to Processed. Then Q6: arb-chair drafted the ADR-000 recommendation
  (Option A / schema-first recommended, renderer choice deferred to
  ADR-002) into ADRs/000-template-authoring-model.md, all 5 decision
  drivers filled with RESULTS.md citations (drivers 2-4 explicitly marked
  unanswered/unanswered-by-choice, not fabricated). Two independent
  skeptics ran the verify stage: both passed 4-5 checks but both
  independently caught the same real defect — the draft called ADR-005
  "accepted"/"accepted-in-principle" three times, but ADRs/README.md:10
  lists it as "Proposed — skill tasks proceed." Corrected all three
  instances and added the missing RESULTS/README citation to driver 5.
  `npm run verify` green after the fix.
- Open: ROADMAP.md:40 (`/adr 000 round-table draft` checkbox) left
  **unticked** — both skeptics flagged a wording tension between the
  roadmap's literal DoD ("decision drivers all evidenced") and the draft
  legitimately marking 2-3 drivers "unanswered by choice," and recommended
  a human/arb-chair ruling rather than the loop self-approving. ADR-000
  Status remains Proposed; Decision line remains "Pending — human decides"
  per CLAUDE.md (only a human closes an ADR). Q6 is otherwise complete.
- Next: either the maintainer rules directly on whether ROADMAP.md:40 can
  be ticked given the "unanswered by choice" drivers, or the next
  dispatcher tick gets an arb-chair ruling on it. After that, Stage 0's
  remaining tasks are the human-only ones: decide ADR-000 itself, and (if
  Path A is chosen) ADR-001. Loop queue (docs/LOOP-PLAN.md Q1-Q6) is now
  fully exhausted — Stage 0 is human-blocked by design from here, not a
  loop failure.

## Loop ticks (noop entries — nothing runnable, logged without a full session entry)

- tick 18, 2026-08-27: noop — unchanged since tick 17, GATE-S1-PREWORK still the only open item. Not a dispatcher tick (18%4≠0).
- tick 17, 2026-08-27: noop — queue empty, docs/INBOX.md Open section empty, not a dispatcher tick (17%4≠0). Only GATE-S1-PREWORK remains open across the whole gate log; nothing else is human-blocked or Claude-doable right now.
- tick 16, 2026-08-27: dispatcher tick (16%4=0). docs/INBOX.md Open empty, but diff since lastDispatchTick=12 caught an un-diffed decision: ADR-001 (Accepted 2026-08-27) routes non-Latin-script documents to Typst, which is GATE-RTL-SHAPING's option 3 verbatim. arb-chair ruled: close the gate as answered indirectly via ADR-001 (chair inference, not a direct INBOX ruling — flagged in the row). Also repointed its stale spike/ evidence paths to docs/RESULTS.md (spike/ deleted at Stage 0 close). No INBOX.md entry needed (not a human submission). GATE-S1-PREWORK left untouched, still open. npm run verify green.
- tick 15, 2026-08-27: noop — Stage 0 CLOSED this session (all 4 exit-gate criteria PASS, spike/ deleted). Queue empty, docs/INBOX.md Open section empty, not a dispatcher tick (15%4≠0). GATE-S1-PREWORK still open (default NO) — loop must not start Stage 1 tasks until answered.
- tick 14, 2026-08-27: noop — queue empty, docs/INBOX.md Open section empty, not a dispatcher tick (14%4≠0). ADR-000 and ADR-001 both Accepted this session (direct maintainer decisions, already reconciled into ROADMAP.md/ADRs/*, no dispatcher action needed). Remaining Stage 0 work: GATE-BURST-WINDOW (open), GATE-S1-PREWORK (open), spike/ deletion blocked on exit gate.
- tick 13, 2026-08-27: noop — queue empty, docs/INBOX.md Open section empty, not a dispatcher tick (13%4≠0). GATE-BURST-WINDOW and GATE-S1-PREWORK still open; ADR-001 (pagination location) still undecided — all human-blocked.
- tick 11, 2026-08-26: noop — queue empty (Q1-Q6 all done), docs/INBOX.md Open section empty, not a dispatcher tick (11%4≠0). Only remaining Stage 0 work is [HUMAN]-only (decide ADR-000/001) or a stale-checkbox reconciliation (RTL/CJK, bursting math ROADMAP lines vs. already-done Q3/Q4 — noted in the ROADMAP.md:40-ruling session entry) that's deferred to the next dispatcher pass (tick 12).
- tick 9, 2026-08-26: noop — unchanged, GATE-CARBONE still open.
- tick 8, 2026-08-26: dispatcher noop (2/3 consecutive) — docs/INBOX.md still empty, no gates answered. Q6 still blocked on GATE-CARBONE.
- tick 7, 2026-08-26: noop — same as tick 6, GATE-CARBONE still unanswered.
- tick 6, 2026-08-26: noop — Q6 (/adr 000 draft) blocked on GATE-CARBONE (docs/INBOX.md empty, no soffice/libreoffice on this Mac). Queue empty otherwise.

## 2026-08-26 — Stage 0 (loop tick 5)
- Did: Q5 typst bench + RTL/CJK column. GATE-TYPST-INSTALL answered (typst
  0.15.1 found on PATH — installed outside the loop). Cold-process
  p50=100ms (n=15, 3 pages), vs container 459ms. Wrote
  spike/typst/rtl-cjk-smoke.typ mirroring the pdf-direct smoke test.
  **Caught and corrected my own tick-3 mistake**: the ar-SA verdict
  ("pdf-lib does no bidi/shaping") was a snap judgment from a small
  thumbnail, not rigorously checked. Redid it with isolated renders +
  explicit-codepoint order test + pixel-cluster analysis: pdf-lib's bidi
  and Arabic joining are actually correct, matching Typst almost exactly
  on pure Arabic text. The real defect is narrower: SFArabic.ttf has zero
  Latin/digit glyphs (a macOS OS-fallback-only font), and pdf-lib has no
  font-fallback chain, so Arabic+numbers — the normal shape of a real
  invoice — renders missing-glyph boxes for the numbers. Typst has
  automatic fallback and passes. Also found Typst's combined 3-script PDF
  is 21KB vs pdf-lib's 5.8MB CJK workaround. Corrected RESULTS.md and
  GATE-RTL-SHAPING (marked superseded, not silently rewritten) to reflect
  this.
- Open: GATE-CARBONE still blocks Q6 (the /adr 000 draft needs the
  carbone row filled, or an explicit "skip carbone" in docs/INBOX.md).
- Next: Q6 is the last queued item and it's gated. If GATE-CARBONE is
  still unanswered next tick, the loop goes fully human-blocked — nothing
  left in the queue that isn't waiting on you. Worth checking
  docs/INBOX.md; five gates are open, most consequential is now resolved
  (GATE-RTL-SHAPING, corrected) and GATE-BURST-WINDOW (no longer
  load-bearing per Q4's margin).

## 2026-08-26 — Stage 0 (loop tick 4, dispatcher)
- Did: dispatcher pass (tick % 4 == 0) — docs/INBOX.md Open section empty,
  no gate answered, nothing to rule on; no arb-chair spawn needed
  (consecutiveNoopDispatches now 1). Then Q4: parametrized bursting math —
  5/15/30/60-min windows for 8,000 docs vs pdf-direct's measured
  p50=12.1ms. Clears every window 3.1x-37.2x single-threaded (~97s total
  sequential). Conclusion: pdf-direct throughput is not the bottleneck at
  any plausible window; GATE-RTL-SHAPING is the real open question, not
  bursting.
- Open: GATE-BURST-WINDOW still unanswered but no longer load-bearing for
  the pdf-direct verdict; carbone/typst rows still need their gates.
- Next: Q5 — typst bench, blocked on GATE-TYPST-INSTALL (`brew install
  typst`); the loop will not self-install. If still blocked next tick,
  Q6 (/adr 000 draft) is also blocked on GATE-CARBONE — loop likely goes
  human-blocked from here until you answer something in docs/INBOX.md.

## 2026-08-26 — Stage 0 (loop tick 3)
- Did: Q3 RTL/CJK smoke test for pdf-direct — real rasterized evidence, not
  a checkbox rubber-stamp. th-TH PASS. ja-JP FAILS with subsetting on
  (pdf-lib TrueType subsetter bug on a 20k-glyph composite-glyph font ->
  tofu), only passes full-font-embedded (~5.7MB/font). ar-SA FAILS: no
  bidi reordering, no Arabic contextual joining — pdf-lib draws RTL text
  in mirrored logical order. Wrote spike/pdf-direct/ttc-split.js (.ttc ->
  standalone sfnt, dependency-free) + rtl-cjk-smoke.js (`npm run
  spike:rtl-cjk`). RESULTS.md updated with full findings + reproduce steps.
  Logged GATE-RTL-SHAPING (open) — real ADR-000/002 decision point.
- Open: pdf-lib is not provably sufficient as the sole volume renderer for
  non-Latin scripts; GATE-RTL-SHAPING needs a human call (shaping layer /
  second renderer / defer scope).
- Next: Q4 — parametrized bursting math table (window still open via
  GATE-BURST-WINDOW).

## 2026-08-26 — Stage 0 (loop tick 2)
- Did: Q2 pdf-direct bench on target hardware — MacBook Air / Apple M4 /
  24GB / macOS 26.5.2 / Node v26.3.0. p50=12.1ms p95=14.5ms mean=12.3ms
  (n=30). RESULTS.md hardware + gate-5 pdf-direct row filled; bursting
  math shows pdf-direct alone clears 8,000 docs in ~97s single-threaded
  (window itself still open, GATE-BURST-WINDOW).
- Open: typst/LibreOffice not installed on this machine (GATE-TYPST-INSTALL,
  GATE-CARBONE).
- Next: Q3 — RTL/CJK smoke test (th-TH, ja-JP, ar-SA) in pdf-direct using
  macOS system fonts.

## 2026-08-26 — Stage 0 (loop tick 1)
- Did: Q1 bootstrap — `npm install` root + spike/pdf-direct (lockfiles
  committed, 0 vulns in prod deps); `npm run verify` green; `spike:data`
  run twice → byte-identical sha256 across both runs on this machine.
- Open: Q2 (pdf-direct bench on this Mac) next.
- Next: Q2 — render-engineer runs `npm run spike:pdf-direct`, fills
  RESULTS.md hardware section + gate-5 pdf-direct row.

## 2026-08-26 (later) — design consolidation (container)
- Did: docs/HLD.md landed in-repo (topologies T1-T3 + transactional outbox,
  RenderJob seam, standards-aware renderer routing); docs/UI-DESIGN.md (five
  principles, 6 sections / 11 screens, screen one-liners, absent-list);
  ADR-007 packaging (Proposed, drafted), ADR-008 licence (Proposed, stub);
  ROADMAP gained commercial gates C1-C3 + parking rule, console tasks in
  S3/S4/S5, embeddable-module+outbox task, thesis check; new agent
  console-designer; CLAUDE.md read order + UI rule.
- Open: unchanged Stage 0 human tasks (carbone bench, hardware re-measure,
  CCL read, ADR-000); ADR-008 is human-only.
- Next: still the carbone template + bench — nothing above unblocks without it.

## 2026-08-26 — Stage 0 (scaffold session, container)
- Did: repo scaffolded; pdf-direct spike implemented+verified (3 pages,
  p50=37.8ms, carried/brought-forward chain confirmed on rasterized page 2);
  typst spike implemented+verified (state-based running footer works,
  cold-process p50≈459ms); carbone harness + TEMPLATE.md ready (needs
  LibreOffice); schema contracts typecheck under --strict; ADRs 000–004
  drafted; Claude Code layer added (CLAUDE.md, 4 agents, 4 commands, settings).
- Open: carbone spike unrun; RTL/CJK smoke test; hardware re-measure; CCL
  licence read; ADR-000 undecided.
- Next: /next will point at authoring po-template.odt and running the carbone
  bench — that is the human-hardware task everything waits on.
