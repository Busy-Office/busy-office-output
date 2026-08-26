# ADR-007 — Packaging and embedding model

**Status:** Proposed — recommendation drafted; closes when Stage 3 begins.

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
