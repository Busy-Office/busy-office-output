-- Persist retentionUntil on the registry row (ROADMAP Stage 3, "Archive
-- store ... with mandatory retentionUntil"). HLD: retentionUntil is
-- mandatory on an Artifact once archived; the registry row is the
-- system's durable, queryable record of every artifact (CLAUDE.md golden
-- rule: "one row per artifact, forever"), and Stage 4's "Retention per doc
-- type enforced end-to-end" needs somewhere to read the deadline back
-- from that isn't buried in the archive backend (the FS backend's sidecar
-- JSON file, or S3 object metadata — neither is queryable). This column is
-- the source of truth; any per-backend copy is redundant insurance only.
--
-- Nullable, not NOT NULL: a row starts DRAFT (0001_init.sql) before
-- anything has been archived, same reasoning as archive_ref being
-- nullable. Enforcement that retentionUntil is present lives in
-- application code, at the ArchiveStore boundary (src/archive/
-- archive-store.ts's assertValidRetentionUntil) and in
-- RegistryStore.updateArchiveRef, not as a DB constraint — a DRAFT row
-- with no retention yet is valid; an archive() call that omits it is not.

ALTER TABLE document_registry ADD COLUMN retention_until TEXT;
