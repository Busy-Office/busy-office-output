-- Reprint log (ROADMAP Stage 5 task 2, arb-chair ruling 2026-08-29 —
-- ADR-007 v1.1 amendment: "stamp = a reprint_log row").
--
-- ONE table, append-only, same precedent as delivery_history (0001),
-- trace_log (0007) and template_lifecycle_log (0012): a row, once written,
-- is never edited or deleted. This IS the "state stamp as metadata" the
-- roadmap task names — the archived artifact's bytes are immutable
-- (CLAUDE.md: "The artifact is immutable once archived"), so the record
-- that someone reproduced / regenerated / reissued a document lives HERE,
-- never inside the bytes and never on the original registry row (which
-- stays ORIGINAL, untouched, updated_at unchanged).
--
-- action:
--   reproduce   the archived bytes were fetched (result_doc_id IS NULL —
--               nothing new was minted)
--   regenerate  a NEW DocumentInstance (state REPRINT) was minted from
--               caller-supplied data against the current published
--               template; result_doc_id = the new row's doc_id. The link
--               original -> reprint lives ONLY here — there is deliberately
--               no `supersedes` column on document_registry.
--   reissue     `emit` with a new BusinessEventKey carried an audit link
--               back to doc_id; result_doc_id = each freshly-minted doc_id
--               (one row per minted resolution).
--
-- actor_role / actor_subject_id: the same `Actor` shape 0012 records;
-- subject_id REQUIRED at the application layer (`actor-required`), reason
-- REQUIRED (`reason-required`) — an audit row with no "who" or "why" is
-- not an audit row.
--
-- Audit only: doc ids, action, actor identity, reason, time. NEVER payload,
-- NEVER artifact bytes, NEVER recipients (CLAUDE.md: no payloads in logs;
-- payslips = PII).
CREATE TABLE reprint_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id            TEXT NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('reproduce', 'regenerate', 'reissue')),
  result_doc_id     TEXT,
  actor_role        TEXT NOT NULL,
  actor_subject_id  TEXT NOT NULL,
  reason            TEXT NOT NULL,
  occurred_at       TEXT NOT NULL
);

CREATE INDEX idx_reprint_log_doc_id ON reprint_log (doc_id, id);
