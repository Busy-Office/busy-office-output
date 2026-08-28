-- Append-only rule-trace log (ROADMAP Stage 3, "Minimal console, read-only":
-- the Rule trace screen, GET /output/trace/:id, needs somewhere durable to
-- read a DeterminationTrace back from — today `determine()` is called fresh
-- per /event call in server.ts's handleEvent and its TRACE only ever
-- reaches the caller as the HTTP response/problem+json body; nothing
-- persists it).
--
-- Same "operational state, not a log" precedent as migrations/0005's
-- composition_outbox: CLAUDE.md's "no payloads in logs" bans DATA-CONTRACT
-- payloads (payslips = PII) from logs — DeterminationTrace (determination/
-- trace.ts) carries only rule ids, matched booleans, specificity/priority
-- numbers, and human-readable per-condition-field `reasons` strings, never
-- contract field values (amounts, names, addresses). This table is read
-- back by id (docId, or a generated id for a no-match call), the same way
-- the API already returns it synchronously — it is the durable half of an
-- existing response, not a new payload sink.
--
-- id: the docId of the PRIMARY (first) resolution when determine()'s
-- outcome is 'matched' — server.ts's handleEvent judgment call, documented
-- there, for the fan-out case where one event yields multiple resolutions/
-- docIds: one trace row per determine() CALL (i.e. per event), not one per
-- resolution. A generated id (randomUUID()) is used for 'no-rule-match'/
-- 'no-template-match' outcomes, which never mint a docId at all.
--
-- Genuinely append-only in intent (a row, once written, is never edited),
-- but a matched call's id is the docId, which is STABLE across a replay of
-- the same event (idempotency) — and determination re-runs on every replay
-- (server.ts: determination happens before the idempotency lookup). Since
-- `determine()` is a pure function of its inputs, a replay's trace is
-- byte-identical to what is already stored under that id, so the
-- application layer (appendTraceLog, sqlite-registry-store.ts) treats a
-- duplicate id as a no-op rather than an error — not a second, distinct
-- "call" worth a second row.
CREATE TABLE trace_log (
  id          TEXT PRIMARY KEY,
  trace       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
