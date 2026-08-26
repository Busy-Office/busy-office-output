# High-level design

Canonical design record. Supersedes the pre-repo HLD draft. Open questions
live in `ADRs/`; UI design in `docs/UI-DESIGN.md`; standards in
`docs/STANDARDS.md`.

## 1. System context

Busy Office Output sits between a business system and the outside world:
events and data in; artifacts, deliveries, and audit out. Not in the boundary:
computing business values (totals/tax arrive correct), holding master data,
acting as a Peppol access point, reporting over databases.

## 2. Components

```
Event API → Determination → Composition → Rendering → Archive → Delivery
 validate    rules+fanout    resolve,      RenderJob    PDF/A-2b   queue,
 contract,   with TRACE      bind, (page)  → bytes      + registry retry,
 idempotency                                            row        channels
```

The seam: **RenderJob** (`packages/schema/src/renderer.ts`) is a union —
`{ kind: 'ir' }` for schema-path renderers, `{ kind: 'office-template' }` for
Carbone — so the runtime is invariant under ADR-000. Layout IR's exact shape
is pending ADR-000/001; if Typst wins Path A, IR narrows to emitted markup.

## 3. Data model (registry-centric)

Template (id, VariantKey, version-immutable-once-published, parentId,
lifecycle, renderer, provenance) · DataContract (documentType, schemaVersion)
· OutputRule (conditions, resolution, priority) · DocumentInstance (docId,
business object+id, template+renderer versions, inputHash, outputHash,
archiveRef, state ORIGINAL/COPY/DUPLICATE/REPRINT/CANCELLED/DRAFT, timestamps)
· DeliveryAttempt (append-only) · Artifact (mediaType, bytes, retentionUntil —
mandatory).

## 4. Flows

Synchronous `POST /render` = preview: no archive, no delivery, no registry.
Event flow: validate → determination (fan-out: one event → N resolutions —
bursting is fan-out, not a subsystem) → compose → render → archive → registry
row → enqueue delivery. Delivery failure never re-renders. Idempotency key
`(businessObject, businessObjectId, event, templateVersion)`: replay returns
the existing docId.

## 5. Template resolution

Most-specific-match over `(documentType, companyCode, country, partnerId,
locale)`; first match wins; resolved template merges up its `parentId` chain.
Templates are never copied. Locale is part of the key from day one.

## 6. Renderers

Per-template property, never global. Capability flags include PDF standards
(`a-2b`, `a-3b`, `ua-1`) so determination can route compliance-bound documents
(ADR-006). Landscape: Typst ≥0.14 = full PDF/A + UA-1, tagged by default;
LibreOffice/Carbone = A-1b/2b/3b; pdf-direct = fast (38ms container p50) but
needs embedded fonts + XMP + OutputIntent to claim A-2b.

## 7. Expression policy

Path A: allowlisted grammar, no eval/imports/IO, unknown identifiers rejected
at publish time. Path B: Carbone formatter allowlist + binary-template review
procedure. Either way: templates never touch data sources directly.

## 8. Determinism and reproduction

The archived artifact is the reproduction; archived artifacts are PDF/A-2b
(A-3b when embedding), veraPDF-validated in CI. Re-rendering old documents is
unsupported. Determinism is a test-time concern: normalize CreationDate/
ModDate + doc ID before hashing. PDF/A forbids artifact encryption;
confidentiality is storage-level (encryption at rest, signed short-TTL URLs).

## 9. Failure model

Contract invalid → 400 problem+json. No rule match → error carrying the full
evaluated TRACE (never silent). Composition overflow → document FAILED, never
clipped. Render crash → one retry then terminal. Delivery → backoff, capped,
poison + alert; artifact untouched.

## 10. Security and data protection

Document-level authorization: reproduce/regenerate/reissue evaluated against
the document (HR clerk vs employee = same endpoint, different outcome).
Mandatory retention per doc type. No payloads in logs — hashes, docIds, rule
traces only. AI loops run on synthetic/redacted inputs by default (ADR-005).

## 11. Deployment topologies (ADR-007)

Same packages, three shapes:

- **T1 embedded** — `createOutput({ db, archive, renderers })` mounted inside
  the host (busy-office-erp): one process, shared Postgres (`bo_output.*`),
  FS archive, in-process worker. Enables the **transactional outbox**: the
  output event is written in the same DB transaction as the business posting —
  rollback leaves no orphaned artifact. (SAP's NAST table is this pattern,
  forty years early.)
- **T2 split worker** — host process + `bo-output worker` on the same
  database; heavyweight renderers (LibreOffice) isolated here.
- **T3 standalone** — `bo-output serve`, multiple hosts/tenants; the
  `output-client` package implements the same `OutputPort` interface so
  callers are topology-blind.

Package map: `output-schema` (contracts, zero-dep) · `output` (runtime:
module + CLI) · `output-render-*` (one package per renderer; pdf-direct is
the pure-npm batteries-included default) · `output-client`. Output stays
ERP-agnostic: busy-office-erp is consumer #1, never owner.

## 12. Console

Six sections, eleven screens, depth ≤ 2, one primary action per screen —
full IA and per-screen specs in `docs/UI-DESIGN.md`. Console pages are
busy-office-ui pages mounted at `/output`; this is the one shared surface
between the two products.

## 13. Decisions

All open questions are ADRs (000 authoring model · 001 pagination · 002
volume renderer · 003 rule storage · 004 queue · 005 AI lifecycle · 006
standards, accepted · 007 packaging · 008 licence/business model). A stage
does not close with its ADRs open.

## 14. Non-goals

Not a reporting engine, not a Peppol access point, not a print server, not a
spreadsheet generator, not a signature authority, not a drag-drop canvas
builder.
