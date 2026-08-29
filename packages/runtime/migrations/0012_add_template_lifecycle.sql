-- Template lifecycle log (ROADMAP Stage 5 task 1, arb-chair ruling
-- 2026-08-29: "state lives in a PERSISTED append-only log; the registered
-- meta is declaration + seed only").
--
-- ONE table, append-only, same precedent as delivery_history (0001) and
-- trace_log (0007): a row, once written, is never edited or deleted. The
-- CURRENT state of a `templateId@version` is the latest row for that key
-- (highest `id`) — there is deliberately NO second "current state" table
-- to keep in sync; the index below makes "latest row per key" one cheap
-- lookup.
--
-- from_state is NULL on the SEED row only: the row `registerDocumentType`
-- writes the first time it sees a key with no history, carrying the
-- lifecycle the definition DECLARED (`TemplateMeta.lifecycle` is the
-- declared initial state, nothing more). If a row already exists the store
-- wins and the declaration is ignored — registration never re-seeds and
-- never fails on drift.
--
-- actor_role / actor_subject_id: the `Actor` shape authorization-port.ts
-- already has (`role`, `subjectId`), reused unchanged. subjectId is
-- REQUIRED here at the application layer (refusal `actor-required`) because
-- separation of duties (review -> approved must not be approved by the
-- submitter) is a comparison of subject ids. reason is REQUIRED on every
-- transition (refusal `reason-required`).
--
-- Audit only: template ids, versions, states, actor identity, reason, time.
-- Never template content, never a payload (CLAUDE.md: no payloads in logs).
--
-- Transport: there is ONE environment (ADR-009). `published` IS production
-- in it; `review` is the QAS analogue. No environment column, no promotion.
CREATE TABLE template_lifecycle_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id       TEXT NOT NULL,
  version           TEXT NOT NULL,
  from_state        TEXT,
  to_state          TEXT NOT NULL,
  actor_role        TEXT NOT NULL,
  actor_subject_id  TEXT NOT NULL,
  reason            TEXT NOT NULL,
  occurred_at       TEXT NOT NULL
);

CREATE INDEX idx_template_lifecycle_log_key
  ON template_lifecycle_log (template_id, version, id);
