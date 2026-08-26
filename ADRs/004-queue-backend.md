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
_Pending. Leaning option 2 if the registry lands on Postgres anyway._
