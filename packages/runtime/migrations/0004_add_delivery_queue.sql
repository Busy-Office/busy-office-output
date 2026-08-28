-- Delivery queue (ROADMAP Stage 3, "Delivery queue: retry w/ backoff ->
-- terminal poison + alert; never re-render on delivery failure"). This is
-- a NEW concern distinct from `delivery_history` (0001_init.sql), which
-- only ever RECORDS completed delivery events for the audit trail. This
-- table is the mechanism: one row per delivery JOB (docId + archiveRef's
-- owning doc + channel + recipients), tracking retry state until the job
-- reaches a terminal outcome. `delivery_history` still gets one appended
-- row per attempt (success or failure) via the existing
-- RegistryStore.appendDeliveryEvent — this table does not replace that,
-- it drives it.
--
-- status enum (documented here, enforced in application code — SQLite has
-- no native enum type): pending (queued or awaiting retry),
-- in_progress (an attempt is currently running), delivered (terminal,
-- success), poison (terminal, retries exhausted — NOT deleted; the DoD
-- requires a poison row to remain queryable, and CLAUDE.md's core
-- guarantee is that a poisoned job never triggers re-render — the
-- archived artifact this job pointed at is untouched regardless of how
-- this row ends up).
--
-- recipients is a JSON array (TEXT) rather than a child table: recipients
-- are an opaque address list to the queue mechanism itself (real
-- validation/parsing is the Channels task's job, not this one) and never
-- queried by individual recipient here.
--
-- next_attempt_at implements the backoff policy: an attempt is only
-- eligible to run once `next_attempt_at <= now`. Present even on the
-- first, not-yet-attempted row (set to the enqueue time) so "due for
-- processing" is always one comparison, first attempt or retry alike.

CREATE TABLE delivery_queue (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id            TEXT NOT NULL REFERENCES document_registry(doc_id),
  channel           TEXT NOT NULL,
  recipients        TEXT NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Poison-job lookups (DoD: "a poison row/query surfaces it") and the
-- future single-process worker's due-job scan both filter on `status`
-- first; `next_attempt_at` narrows the due-job scan further.
CREATE INDEX idx_delivery_queue_status ON delivery_queue (status, next_attempt_at);
CREATE INDEX idx_delivery_queue_doc_id ON delivery_queue (doc_id);
