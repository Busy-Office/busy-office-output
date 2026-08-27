# ADR-004 — Delivery queue backend

**Status:** Proposed. Closes in Stage 3.

## Context
The single-process topology (HLD §11) is non-negotiable — evaluators will not
install a broker. So an embedded queue exists regardless; the question is only
whether an external adapter (Redis/SQS) is needed before Stage 5 scale work.
Novu's BullMQ/Redis design is the reference for the scaled shape.

## Options
1. SQLite-backed embedded queue only, adapter interface reserved
2. Postgres-backed (SKIP LOCKED) — one store for registry + queue
3. External broker from day one — rejected: kills the single-binary story

## Decision

**Accepted 2026-08-28: Option 1 (SQLite-backed embedded queue, adapter
interface reserved).**

This ADR's own stated leaning ("option 2 if the registry lands on
Postgres anyway") was explicitly conditional. That condition is now
resolved: Stage 3's Document registry task landed on `node:sqlite`
(`packages/runtime/src/registry/sqlite-registry-store.ts`), not Postgres
— a deliberate arb-chair ruling made specifically to avoid this ADR being
pre-decided by the registry's implementation choice
(`docs/SESSION-LOG.md`, 2026-08-27 registry entry). With the registry on
SQLite, Option 2's own rationale ("one store for registry + queue")
argues for SQLite too, not Postgres — running two different embedded
databases in single-process mode would contradict HLD §11's
non-negotiable single-process topology and undercut the "fresh clone →
serve → zero external services" DoD on the Stage 3 roadmap.

The adapter interface is reserved (per this option's own text) so an
external backend (Postgres SKIP LOCKED, or a broker) can be added later
behind the same seam without rework, matching how the registry's
`RegistryStore` port was built.

Decided directly by the maintainer in chat, 2026-08-28.
