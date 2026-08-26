# Reproduction policy

Written once, referenced everywhere (CLAUDE.md, HLD §8/§9). This is the
single canonical statement — do not restate or fork it elsewhere; link here.

## The archive is the reproduction

Once a `DocumentInstance` is archived, the **archived artifact bytes are the
reproduction**, full stop. "Reprint" means re-delivering the archived bytes,
never re-running determination/composition/rendering against current
templates, current rules, or current business data.

Consequences:

- **Delivery failure never triggers re-render.** A failed delivery attempt
  (`DeliveryAttempt`, append-only) retries the *delivery* of the existing
  artifact — with backoff, capped, poison + alert on exhaustion — and never
  invokes rendering again. The artifact itself is untouched by delivery
  failure (HLD §9).
- **Re-rendering old documents is unsupported.** There is no "regenerate
  this invoice" operation. A business correction is a new business event
  producing a new `DocumentInstance` (state `REPRINT` or a fresh
  `ORIGINAL`/`COPY` per the registry's state machine), never a mutation of
  an existing archived artifact.
- **Templates are versioned and immutable once published**
  (`TemplateMeta.version`, `packages/schema/src/document/template.ts`)
  precisely so that "what produced this archived artifact" stays answerable
  without needing to re-run anything.

## Determinism is test-time only

Determinism (byte-identical output for byte-identical input) is a property
the test corpus verifies at build/CI time — it is **not** a runtime
guarantee the product makes to callers, and it is never invoked to justify
re-rendering. Two consequences:

- Corpus snapshot tests normalize `CreationDate`/`ModDate` and the PDF
  document ID before hashing (the pattern already used in Stage 0 spikes;
  see `docs/RESULTS.md`), because those fields are legitimately
  wall-clock-dependent and would otherwise make byte-identical comparison
  meaningless.
- Production renders are **not** re-run to verify they match a prior render
  of the "same" input — that would contradict "the archive is the
  reproduction." Determinism testing exists to catch renderer regressions
  before release, not to police production output after the fact.

## Archive format and confidentiality

- Archived artifacts are **PDF/A-2b** (ISO 19005-2), **PDF/A-3b** when
  embedding attachments (Stage 4 concatenation, Tier 3 Factur-X) — validated
  by veraPDF in CI. No compliance claim without the validator passing
  (`docs/STANDARDS.md`).
- **PDF/A forbids artifact-level encryption.** Confidentiality is
  storage-level: encryption at rest plus short-TTL signed URLs for access,
  never encryption baked into the artifact itself (HLD §8).

## Payslip / PII handling

Payslips carry PII (`packages/schema/contracts/payslip.schema.json`,
`x-pii: true`). The reproduction policy applies identically — the archived
artifact is still the sole reproduction — but the runtime must never log a
payslip's data-contract payload at any stage (determination, composition,
delivery, audit). Audit trails carry hashes and rule traces only, never the
payload itself (CLAUDE.md).
