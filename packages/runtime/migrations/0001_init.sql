-- Document registry (ROADMAP Stage 3, HLD §3 "Data model (registry-centric)").
-- One row per artifact, forever (CLAUDE.md golden rule) — this table is
-- never deleted from, only inserted into and updated in place; delivery
-- history is append-only in its own child table.
--
-- state enum values (documented here, enforced in application code since
-- SQLite has no native enum type): DRAFT, ORIGINAL, COPY, DUPLICATE,
-- REPRINT, CANCELLED. New rows are inserted as DRAFT — nothing has been
-- rendered or archived yet at the point a docId is minted (ingress/
-- idempotency time); a later task (Archive store) is what transitions a
-- row to ORIGINAL once bytes are actually archived.

CREATE TABLE document_registry (
  doc_id              TEXT PRIMARY KEY,
  business_object     TEXT NOT NULL,
  business_object_id  TEXT NOT NULL,
  event               TEXT NOT NULL,
  template_version    TEXT NOT NULL,
  renderer_version    TEXT,
  input_hash          TEXT,
  output_hash         TEXT,
  archive_ref         TEXT,
  state               TEXT NOT NULL DEFAULT 'DRAFT',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- The idempotency key (HLD §4): replay of this four-tuple must resolve to
-- the same doc_id, enforced here (not just in application code) so a race
-- or a bug in the lookup path fails loudly (UNIQUE violation) rather than
-- silently minting a duplicate row.
CREATE UNIQUE INDEX idx_document_registry_event_key
  ON document_registry (business_object, business_object_id, event, template_version);

-- Delivery history (HLD §3: "DeliveryAttempt (append-only)"). The registry
-- only RECORDS delivery events here — it never performs delivery itself
-- (that is the separate, later Delivery queue / Channels tasks).
CREATE TABLE delivery_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id       TEXT NOT NULL REFERENCES document_registry(doc_id),
  channel      TEXT NOT NULL,
  status       TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  detail       TEXT
);

CREATE INDEX idx_delivery_history_doc_id ON delivery_history (doc_id);
