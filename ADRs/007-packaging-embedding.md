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
`status`. The console stays read-only on the document registry; the
single exception is `POST /output/templates/:id/:ver/review`, which writes
only the lifecycle log (Stage 5 task 4); the actor is proxy-asserted
(`X-Actor-*`, injectable `resolveActor`), lifecycle-audit identity only,
never fed to AuthorizationPort.

Not built, by ruling: `reproduce`'s body, a `preview` that determines, npm
publishing, the package-map split, plugin/discovery (no directory scan, no
package.json keywords, no dynamic import by name), hot-reload / unregister /
re-register, per-type authorization policy.

### Amendment 2026-08-29 (same day, still Proposed) — v1.1: reprint verbs (Stage 5 task 2)

Ruled by arb-chair for Stage 5 task 2; amended in place because the
addendum is Proposed, not Accepted. Two corrections to the task brief
drove the shape: `ReproduceInput` on main has no `channel` field (so
"reproduce" is bytes only, no delivery — GAP-22), and a visible watermark
is closed by the frozen expression grammar (GAP-23). One verb per KIND of
side effect: fetch / new artifact / new event.

```ts
interface ReproduceInput  { docId: string; actor: Actor; reason: string }
type  ReproduceResult =
  | { status: 'forbidden' | 'unknown-document' | 'not-archived'
             | 'actor-required' | 'reason-required'; docId: string }
  | { status: 'purged'; docId: string; purgedAt: string }
  | { status: 'reproduced'; docId: string; bytes: Uint8Array;
      mediaType?: string; reprintLogId: number };
// `not-implemented` REMOVED — a variant that can never be returned is a lie.

interface RegenerateInput { docId: string; actor: Actor; reason: string;
                            payload: unknown;
                            determination?: CallerDeterminationContext }
type  RegenerateResult =
  | { status: 'forbidden' | 'unknown-document' | 'actor-required'
             | 'reason-required'; docId: string }
  | { status: 'invalid-contract'; /* as EmitResult */ }
  | { status: 'no-rule-match' | 'no-template-match'
             | 'unresolved-recipients' | 'unresolved-message-template'; trace }
  | { status: 'regenerated'; originalDocId: string; docId: string;
      state: 'REPRINT'; composition: CompositionOutcome; trace };

// reissue: NO verb — it IS emit with a new BusinessEventKey.
// EmitInput.reissues?: { docId; actor; reason } adds only the audit link.
```

Semantics: reproduce = `ArchiveStore.retrieve(row.archiveRef)`, bytes
byte-identical, original row untouched, stamp = a `reprint_log` row
(migration 0013, append-only: id, doc_id, action, result_doc_id, actor
role/subject, reason, occurred_at — never payload/bytes/recipients).
regenerate = a NEW DocumentInstance (state REPRINT) rendered from
CALLER-SUPPLIED data against the current published template (task 1's
`liveState`) — the registry holds no payload by design (HLD §1), so a real
ERP re-emits; never "re-render the old document" (POLICY.md unchanged).
Non-idempotent by definition; the mint key is distinguished so the
5-tuple index does not collapse it onto the original. reissue = emit +
audit link, mints a fresh ORIGINAL. All three call
`AuthorizationPort.canAccess(actor, originalRow, action)` first — the
first real caller of that port; `subjectId` and `reason` required.
States written: ORIGINAL (unchanged), REPRINT (regenerate's new row).
COPY/DUPLICATE/CANCELLED stay unused — no semantics invented.
Not built: console buttons (task 4), HTTP transport for the new verbs
(maintainer decides with task 4), delivery from reproduce (GAP-22), any
watermark (GAP-23), any byte modification of an archived artifact.
