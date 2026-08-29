# ADR-007 — Packaging and embedding model

**Status:** Accepted 2026-08-28 — recommendation adopted as drafted, decided
directly by the maintainer in chat, no new evidence against the original
recommendation.

## Context
Busy Office Output will be consumed standalone and inside busy-office-erp.
The question "npm package or service?" is a false choice.

## Recommendation
npm packages whose deployment topology is configuration (HLD §11): T1
embedded module (`createOutput()` + transactional outbox in the host's DB
transaction), T2 split worker, T3 standalone `serve` — same code throughout.
Package map: `output-schema` (zero-dep) · `output` · `output-render-*` (one
per renderer; pdf-direct is the pure-npm default) · `output-client`
(`OutputPort`-compatible, topology-blind callers).

## Boundaries
Output stays ERP-agnostic: separate repo, published packages, busy-office-erp
pins versions like any consumer. Host-side integration points are interfaces
(AuthorizationPort, storage adapters), never imports of host internals.

## Consequences
Stage 3 gains the module-API + outbox task; the single-process gate extends
to "single process can mean inside the host's process".

## Addendum 2026-08-29 — T1 host topology default (gap register GAP-09)

The T1 embedded module (`createOutput()`) drags the `typst` shell-out binary
into any host process that mounts it — lean for the standalone demo is not
lean for an embedding host. Ratified directly by the maintainer in chat:
**T2 split worker is the default for any future embedding host.** A host
embeds the thin API only; rendering runs in a separate worker process that
owns `typst` (and `pdf-direct`'s in-process renderer, though that one has
no binary). The host never needs the binary. This is the T2 topology already
named above, and matches how `serve()` already separates ingress from the
drain worker. Under ADR-009 (standalone product, no active host) nothing is
built now — this records the default so the next embedding conversation
starts from a decision, not a question. HLD §11 should be read with this
addendum.

## Addendum 2026-08-29 — OutputPort v1 surface (gap register GAP-07 / GAP-08)

**Status: Proposed** — drafted from the arb-chair ruling recorded in
`docs/GAP-REGISTER.md`; the maintainer ratifies.

The consumer contract this ADR names ("`output-client` — `OutputPort`-
compatible, topology-blind callers") now has a fixed v1 shape, implemented
in `packages/runtime/src/embed/create-output.ts` and round-tripped by this
project's own `serve()` (ADR-009: standalone product — that is the one
consumer). The package-map split itself stays deferred; nothing is
published.

```ts
interface OutputPort {
  emit(input: EmitInput): Promise<EmitResult>;                  // validate → determine → mint → compose → archive → enqueue
  preview(input: PreviewInput): Promise<PreviewResult>;         // render only; requires templateId; no determination, row, archive, delivery, trace, or docId
  status(key: BusinessEventKey): Promise<DocumentStatus[]>;     // registry read; one per ruleId (fan-out); ownerId never projected
  reproduce(input: ReproduceInput): Promise<ReproduceResult>;   // Stage 5; v1 only ever { status: 'not-implemented', availableFrom: 'stage-5' }
  registerDocumentType(definition: DocumentTypeDefinition): RegistrationResult; // synchronous, process-local, in-order, append-only
  resumeStrandedCompositions(minAgeMs?: number): Promise<ResumeOutcome[]>;      // operational, unchanged
}
```

`emit` is a rename of `submitEvent` with no alias (no external consumer
exists). `DocumentTypeDefinition = { documentType, contract (JSON Schema
2020-12 object, compiled by the engine with ajv strict + `x-pii`),
templates: { meta: TemplateMeta, content?: DocNode }[], rules:
OutputRule[] }` lives in runtime (`src/registration/`), not in
`@busy-office/output-schema` — zero schema change.

Registration inversion (GAP-08): the engine (`packages/runtime/src/**`
minus the composition root `src/index.ts` and tests) knows no document
type. The built-ins moved to `packages/runtime/document-types/` (a sibling
of `rules/`, outside `src/`, not a package — "no package before its stage"
and this ADR's split deferral both forbid one); `src/index.ts` registers
them through `registerDocumentType`. Contract JSON stays in
`packages/schema/contracts/`. A vitest boundary test
(`src/registration/engine-boundary.test.ts`) fails any engine import of
`document-types/`, `rules/`, `contracts/`, or the schema contracts path,
and runs in `npm run verify`.

HTTP transport over the port (`serve()`): `POST /event` → `emit` (response
shape unchanged), `POST /render` → `preview` (bytes back; HLD §4), `GET
/documents?businessObject=&businessObjectId=&event=&templateVersion=` →
`status`. The console stays read-only on the registry.

Not built, by ruling: `reproduce`'s body, a `preview` that determines, npm
publishing, the package-map split, plugin/discovery (no directory scan, no
package.json keywords, no dynamic import by name), hot-reload / unregister /
re-register, per-type authorization policy.
