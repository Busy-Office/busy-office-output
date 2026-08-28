# Architecture Decision Records

| ADR | Title | Status | Closes at |
|---|---|---|---|
| 000 | Template authoring model (Path A / B / hybrid) | **Accepted** — Option C (hybrid), schema-first built now, Carbone reserved/not adopted | end of Stage 0 |
| 001 | Pagination location (composition vs renderer) | **Accepted** — Option 2 (renderer-side/Typst), scoped by document type, not forced cross-renderer parity | end of Stage 1 |
| 002 | Volume renderer | Proposed — inherits ADR-001's document-type-scoped split; must decide the routing rule | Stage 4 latest |
| 003 | Rule storage (files vs tables) | **Accepted** — Option 1 (files first) | end of Stage 3 |
| 004 | Queue backend (embedded vs external) | **Accepted** — Option 1 (SQLite-backed embedded, adapter reserved) | end of Stage 3 |
| 005 | AI-native template lifecycle | Proposed — skill tasks proceed | Stage 7 entry |
| 006 | Standards-first output (tiered) | **Accepted** — maintainer directive | — |
| 007 | Packaging and embedding (T1/T2/T3, outbox) | **Accepted** — recommendation adopted as drafted | end of Stage 3 |
| 008 | Licence and business model (Sidekiq line) | Proposed — human decides | before public release |

A stage does not close with its ADRs open.
