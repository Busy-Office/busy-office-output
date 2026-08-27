-- Disambiguate registry rows per firing rule (ROADMAP Stage 3, "Fan-out: one
-- event → N resolutions"). One event can now legitimately produce several
-- resolutions sharing the SAME (business_object, business_object_id, event,
-- template_version) four-tuple at once (e.g. two fan-out rules routing the
-- same invoice to two different object-store archives on the same template
-- version) — the old four-tuple unique index can no longer tell those rows
-- apart. `rule_id` is the firing OutputRule.id that produced this row;
-- see registry-store.ts's `ResolutionEventKey` doc for the full rationale.
--
-- NOT NULL DEFAULT '': existing rows (minted before this migration, or by
-- any caller still using the plain four-tuple `getOrCreateByEventKey`) get
-- '' — a real, stable, always-the-same-for-that-path value, not NULL
-- (SQLite treats every NULL as distinct for uniqueness purposes, which
-- would silently defeat the unique index below for exactly the rows that
-- most need it enforced). `getOrCreateByEventKey` always looks up/inserts
-- with rule_id = '', so replay of an old-style four-tuple call still
-- resolves to the same row it always did — the existing unique constraint's
-- intent (replay of the exact same identity never mints a duplicate) is
-- preserved, just widened to a fifth column.
ALTER TABLE document_registry ADD COLUMN rule_id TEXT NOT NULL DEFAULT '';

DROP INDEX idx_document_registry_event_key;

CREATE UNIQUE INDEX idx_document_registry_event_key
  ON document_registry (business_object, business_object_id, event, template_version, rule_id);
