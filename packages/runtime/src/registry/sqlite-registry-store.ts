/**
 * SqliteRegistryStore: the default embedded `RegistryStore` implementation
 * (ROADMAP Stage 3). Uses Node's built-in `node:sqlite` (`DatabaseSync`) —
 * deliberately NOT `better-sqlite3` (an extra native binding) and NOT
 * Postgres (that implementation of `RegistryStore` is gated on ADR-004,
 * "if the registry lands on Postgres anyway" — building it now would
 * silently pre-decide an ADR that is still Proposed). `node:sqlite` is
 * confirmed present and stable on this project's Node baseline (>=22; this
 * machine runs v26.3.0) and needed nothing beyond what's in core.
 *
 * One file = one embedded database: pass a real path for durable, on-disk
 * storage (what `serve()` uses by default — CLAUDE.md: "API + worker +
 * embedded queue + FS archive in one command", single-process is sacred),
 * or `:memory:` for fast, isolated tests. Migrations (migrate.ts) run on
 * every construction, so a fresh file or `:memory:` database is always
 * immediately usable.
 */
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { BusinessEventKey } from '@busy-office/output-schema';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// `node:sqlite` is loaded via `createRequire` rather than a static ESM
// import: some toolchains in this repo's dependency graph (Vite's SSR
// module loader, used by vitest) resolve a *static* `import ... from
// 'node:sqlite'` specifier through their own bundler-side builtin list
// instead of Node's real module resolution, and that list does not yet
// know about this comparatively new builtin — the static import fails to
// resolve there even though Node itself (v22+) has always had it. A
// `require()` call is opaque to that resolution step and hits Node's
// module loader directly, which does have it.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};
import { runMigrations } from './migrate.js';
import type {
  DeliveryHistoryEvent,
  DocumentRegistryRow,
  DocumentState,
  GetOrCreateResult,
  ListDocumentsQuery,
  OutboxEntry,
  RegistryStore,
  ResolutionEventKey,
} from './registry-store.js';
import type { DeterminationTrace } from '../determination/trace.js';

/** Default page size for `listDocuments` when `query.limit` is omitted. */
const DEFAULT_LIST_DOCUMENTS_LIMIT = 50;

interface DocumentRow {
  doc_id: string;
  business_object: string;
  business_object_id: string;
  event: string;
  template_version: string;
  renderer_version: string | null;
  input_hash: string | null;
  output_hash: string | null;
  archive_ref: string | null;
  retention_until: string | null;
  purged_at: string | null;
  rule_id: string;
  document_type: string;
  owner_id: string | null;
  locale: string | null;
  state: string;
  created_at: string;
  updated_at: string;
}

interface DeliveryRow {
  channel: string;
  status: string;
  occurred_at: string;
  detail: string | null;
}

function toDeliveryEvent(row: DeliveryRow): DeliveryHistoryEvent {
  const event: DeliveryHistoryEvent = {
    channel: row.channel,
    status: row.status,
    occurredAt: row.occurred_at,
  };
  if (row.detail !== null) {
    event.detail = row.detail;
  }
  return event;
}

export class SqliteRegistryStore implements RegistryStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    runMigrations(this.db);
  }

  getOrCreateByEventKey(key: BusinessEventKey, documentType = '', ownerId?: string, locale?: string): GetOrCreateResult {
    // The plain four-tuple lookup is the fan-out-aware lookup with an
    // explicit '' ruleId — one implementation, one unique index, see
    // registry-store.ts's `ResolutionEventKey` / `rule_id` column doc.
    return this.getOrCreateByResolutionKey({ ...key, ruleId: '' }, documentType, ownerId, locale);
  }

  getOrCreateByResolutionKey(key: ResolutionEventKey, documentType = '', ownerId?: string, locale?: string): GetOrCreateResult {
    const existing = this.selectByResolutionKey(key);
    if (existing !== undefined) {
      return { row: this.toRow(existing), created: false };
    }

    const docId = randomUUID();
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO document_registry
             (doc_id, business_object, business_object_id, event, template_version, document_type, rule_id, owner_id, locale, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
        )
        .run(
          docId,
          key.businessObject,
          key.businessObjectId,
          key.event,
          key.templateVersion,
          documentType,
          key.ruleId,
          ownerId ?? null,
          locale ?? null,
          now,
          now,
        );
    } catch (err) {
      // Concurrent first-sighting (or a re-entrant call) lost the race to
      // the UNIQUE index on the five-tuple — the row now exists; return it
      // rather than treating this as a failure. This does not arise within
      // a single Node event-loop turn (DatabaseSync is synchronous), but
      // guards against it regardless of call pattern.
      const raced = this.selectByResolutionKey(key);
      if (raced !== undefined) {
        return { row: this.toRow(raced), created: false };
      }
      throw err;
    }

    const created = this.selectByDocId(docId);
    if (created === undefined) {
      throw new Error(`Registry insert for docId ${docId} did not become readable.`);
    }
    return { row: this.toRow(created), created: true };
  }

  mintWithOutbox(
    key: ResolutionEventKey,
    resolution: unknown,
    data: unknown,
    documentType = '',
    ownerId?: string,
    locale?: string,
  ): GetOrCreateResult {
    const existing = this.selectByResolutionKey(key);
    if (existing !== undefined) {
      return { row: this.toRow(existing), created: false };
    }

    const docId = randomUUID();
    const now = new Date().toISOString();
    // Mint the registry row and its outbox row in ONE transaction (see
    // migrations/0005_add_composition_outbox.sql) — either both are
    // durable or neither is, so a crash right after this call returns
    // always leaves `resumeStrandedCompositions` something to find.
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO document_registry
             (doc_id, business_object, business_object_id, event, template_version, document_type, rule_id, owner_id, locale, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
        )
        .run(
          docId,
          key.businessObject,
          key.businessObjectId,
          key.event,
          key.templateVersion,
          documentType,
          key.ruleId,
          ownerId ?? null,
          locale ?? null,
          now,
          now,
        );
      this.db
        .prepare('INSERT INTO composition_outbox (doc_id, resolution, data, created_at) VALUES (?, ?, ?, ?)')
        .run(docId, JSON.stringify(resolution), JSON.stringify(data), now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      // Concurrent first-sighting lost the race to the UNIQUE index on the
      // five-tuple (see getOrCreateByResolutionKey's identical guard) — the
      // row now exists (minted by the winner, with its own outbox row);
      // return it rather than treating this as a failure.
      const raced = this.selectByResolutionKey(key);
      if (raced !== undefined) {
        return { row: this.toRow(raced), created: false };
      }
      throw err;
    }

    const created = this.selectByDocId(docId);
    if (created === undefined) {
      throw new Error(`Registry insert for docId ${docId} did not become readable.`);
    }
    return { row: this.toRow(created), created: true };
  }

  getOutboxEntry(docId: string): OutboxEntry | undefined {
    const row = this.db
      .prepare('SELECT doc_id, resolution, data, created_at FROM composition_outbox WHERE doc_id = ?')
      .get(docId) as { doc_id: string; resolution: string; data: string; created_at: string } | undefined;
    return row === undefined ? undefined : this.toOutboxEntry(row);
  }

  listOutboxEntries(): OutboxEntry[] {
    const rows = this.db
      .prepare('SELECT doc_id, resolution, data, created_at FROM composition_outbox ORDER BY created_at ASC')
      .all() as unknown as Array<{ doc_id: string; resolution: string; data: string; created_at: string }>;
    return rows.map((row) => this.toOutboxEntry(row));
  }

  clearOutboxEntry(docId: string): void {
    this.db.prepare('DELETE FROM composition_outbox WHERE doc_id = ?').run(docId);
  }

  private toOutboxEntry(row: { doc_id: string; resolution: string; data: string; created_at: string }): OutboxEntry {
    return {
      docId: row.doc_id,
      resolution: JSON.parse(row.resolution) as unknown,
      data: JSON.parse(row.data) as unknown,
      createdAt: row.created_at,
    };
  }

  getByDocId(docId: string): DocumentRegistryRow | undefined {
    const row = this.selectByDocId(docId);
    return row === undefined ? undefined : this.toRow(row);
  }

  updateState(docId: string, state: DocumentState): void {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE document_registry SET state = ?, updated_at = ? WHERE doc_id = ?')
      .run(state, now, docId);
    if (result.changes === 0) {
      throw new Error(`Cannot update state: no registry row for docId ${docId}.`);
    }
  }

  updateArchiveRef(docId: string, archiveRef: string, retentionUntil: string, rendererVersion: string): void {
    if (typeof archiveRef !== 'string' || archiveRef.trim() === '') {
      throw new TypeError('updateArchiveRef requires a non-empty archiveRef.');
    }
    if (typeof retentionUntil !== 'string' || retentionUntil.trim() === '') {
      throw new TypeError('updateArchiveRef requires a non-empty retentionUntil.');
    }
    if (typeof rendererVersion !== 'string' || rendererVersion.trim() === '') {
      throw new TypeError('updateArchiveRef requires a non-empty rendererVersion (rendererId@version).');
    }
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'UPDATE document_registry SET archive_ref = ?, retention_until = ?, renderer_version = ?, updated_at = ? WHERE doc_id = ?',
      )
      .run(archiveRef, retentionUntil, rendererVersion, now, docId);
    if (result.changes === 0) {
      throw new Error(`Cannot update archiveRef: no registry row for docId ${docId}.`);
    }
  }

  listArchivedExpiring(now: string): DocumentRegistryRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM document_registry
         WHERE archive_ref IS NOT NULL AND purged_at IS NULL
           AND retention_until IS NOT NULL AND retention_until <= ?
         ORDER BY retention_until ASC`,
      )
      .all(now) as unknown as DocumentRow[];
    return rows.map((row) => this.toRow(row));
  }

  markPurged(docId: string, purgedAt: string): void {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE document_registry SET archive_ref = NULL, purged_at = ?, updated_at = ? WHERE doc_id = ?')
      .run(purgedAt, now, docId);
    if (result.changes === 0) {
      throw new Error(`Cannot mark purged: no registry row for docId ${docId}.`);
    }
  }

  appendDeliveryEvent(docId: string, event: DeliveryHistoryEvent): void {
    const doc = this.selectByDocId(docId);
    if (doc === undefined) {
      throw new Error(`Cannot append delivery event: no registry row for docId ${docId}.`);
    }
    this.db
      .prepare('INSERT INTO delivery_history (doc_id, channel, status, occurred_at, detail) VALUES (?, ?, ?, ?, ?)')
      .run(docId, event.channel, event.status, event.occurredAt, event.detail ?? null);
  }

  listDocuments(query: ListDocumentsQuery = {}): DocumentRegistryRow[] {
    const search = query.search?.trim() ?? '';
    const limit = query.limit ?? DEFAULT_LIST_DOCUMENTS_LIMIT;
    const offset = query.offset ?? 0;

    const rows =
      search === ''
        ? (this.db
            .prepare('SELECT * FROM document_registry ORDER BY created_at DESC LIMIT ? OFFSET ?')
            .all(limit, offset) as unknown as DocumentRow[])
        : (() => {
            const like = `%${search}%`;
            return this.db
              .prepare(
                `SELECT * FROM document_registry
                 WHERE doc_id LIKE ? OR business_object_id LIKE ? OR event LIKE ? OR template_version LIKE ?
                 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
              )
              .all(like, like, like, like, limit, offset) as unknown as DocumentRow[];
          })();

    return rows.map((row) => this.toRow(row));
  }

  listByEventKey(key: BusinessEventKey): DocumentRegistryRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM document_registry
         WHERE business_object = ? AND business_object_id = ? AND event = ? AND template_version = ?
         ORDER BY created_at ASC, rule_id ASC`,
      )
      .all(key.businessObject, key.businessObjectId, key.event, key.templateVersion) as unknown as DocumentRow[];
    return rows.map((row) => this.toRow(row));
  }

  appendTraceLog(id: string, trace: DeterminationTrace): void {
    // INSERT OR IGNORE: a replay of the same event re-runs determine()
    // (server.ts: determination happens before the idempotency lookup),
    // producing an id (the docId) that may already have a row. determine()
    // is a pure function of its inputs, so the replay's trace is
    // byte-identical to what is already stored — a no-op, not an error or
    // a second row. See migrations/0007_add_trace_log.sql.
    this.db
      .prepare('INSERT OR IGNORE INTO trace_log (id, trace, created_at) VALUES (?, ?, ?)')
      .run(id, JSON.stringify(trace), new Date().toISOString());
  }

  getTraceLog(id: string): DeterminationTrace | undefined {
    const row = this.db.prepare('SELECT trace FROM trace_log WHERE id = ?').get(id) as
      | { trace: string }
      | undefined;
    return row === undefined ? undefined : (JSON.parse(row.trace) as DeterminationTrace);
  }

  close(): void {
    this.db.close();
  }

  private selectByResolutionKey(key: ResolutionEventKey): DocumentRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM document_registry
         WHERE business_object = ? AND business_object_id = ? AND event = ? AND template_version = ? AND rule_id = ?`,
      )
      .get(key.businessObject, key.businessObjectId, key.event, key.templateVersion, key.ruleId) as
      | DocumentRow
      | undefined;
  }

  private selectByDocId(docId: string): DocumentRow | undefined {
    return this.db.prepare('SELECT * FROM document_registry WHERE doc_id = ?').get(docId) as
      | DocumentRow
      | undefined;
  }

  private selectDeliveryHistory(docId: string): DeliveryHistoryEvent[] {
    const rows = this.db
      .prepare('SELECT channel, status, occurred_at, detail FROM delivery_history WHERE doc_id = ? ORDER BY id ASC')
      .all(docId) as unknown as DeliveryRow[];
    return rows.map(toDeliveryEvent);
  }

  private toRow(doc: DocumentRow): DocumentRegistryRow {
    return {
      docId: doc.doc_id,
      businessObject: doc.business_object,
      businessObjectId: doc.business_object_id,
      event: doc.event,
      templateVersion: doc.template_version,
      rendererVersion: doc.renderer_version,
      inputHash: doc.input_hash,
      outputHash: doc.output_hash,
      archiveRef: doc.archive_ref,
      retentionUntil: doc.retention_until,
      purgedAt: doc.purged_at,
      ruleId: doc.rule_id,
      documentType: doc.document_type,
      ownerId: doc.owner_id,
      locale: doc.locale,
      state: doc.state as DocumentState,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      deliveryHistory: this.selectDeliveryHistory(doc.doc_id),
    };
  }
}

export function createSqliteRegistryStore(dbPath: string): RegistryStore {
  return new SqliteRegistryStore(dbPath);
}
