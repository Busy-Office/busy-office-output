-- Transactional outbox for composition work (ROADMAP Stage 3, "Embeddable
-- module (ADR-007): createOutput() ... transactional outbox").
--
-- The gap this closes: `getOrCreateByResolutionKey` mints a docId (and a
-- DRAFT document_registry row) BEFORE composition (render + archive +
-- enqueue, composition.ts) even starts. If the process crashes between
-- mint and archive-complete, a replay of the same event sees the row
-- already exists (`created: false`) and, historically, nothing re-drove
-- the stranded composition work — the row sat DRAFT with no archiveRef
-- forever.
--
-- Fix: `SqliteRegistryStore.mintWithOutbox` inserts the document_registry
-- row AND a composition_outbox row for it in ONE SQLite transaction
-- (BEGIN/COMMIT — same pattern migrate.ts already uses). Either both rows
-- exist or neither does; there is no window where a docId is minted
-- without a durable record of the work still owed on it. Once
-- composeRenderArchiveAndEnqueue has run to completion for a docId (any
-- outcome — rendered, no-template-content, or render-failed), its outbox
-- row is deleted (`clearOutboxEntry`). A row that still exists is, by
-- definition, unfinished composition work: either genuinely still running
-- in this process, or stranded by a crash. `resumeStrandedCompositions`
-- (composition.ts) re-drives every row still present.
--
-- `resolution` and `data` are stored JSON-encoded: the exact
-- `Resolution` and `DataContractEnvelope` composeRenderArchiveAndEnqueue
-- needs to redo its work after a crash, without re-ingesting the original
-- event from outside the process. This is a deliberate, bounded exception
-- to "no payloads in logs" (CLAUDE.md) — it is not a log, it is the
-- operational state a transactional outbox inherently requires to be
-- resumable, and rows live only from mint to composition-complete
-- (milliseconds on the normal path) before being deleted, not merely
-- marked.
CREATE TABLE composition_outbox (
  doc_id      TEXT PRIMARY KEY REFERENCES document_registry(doc_id),
  resolution  TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_composition_outbox_created_at ON composition_outbox (created_at);
