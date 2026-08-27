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
  RegistryStore,
  ResolutionEventKey,
} from './registry-store.js';

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
  rule_id: string;
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

  getOrCreateByEventKey(key: BusinessEventKey): GetOrCreateResult {
    // The plain four-tuple lookup is the fan-out-aware lookup with an
    // explicit '' ruleId — one implementation, one unique index, see
    // registry-store.ts's `ResolutionEventKey` / `rule_id` column doc.
    return this.getOrCreateByResolutionKey({ ...key, ruleId: '' });
  }

  getOrCreateByResolutionKey(key: ResolutionEventKey): GetOrCreateResult {
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
             (doc_id, business_object, business_object_id, event, template_version, rule_id, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
        )
        .run(docId, key.businessObject, key.businessObjectId, key.event, key.templateVersion, key.ruleId, now, now);
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

  updateArchiveRef(docId: string, archiveRef: string, retentionUntil: string): void {
    if (typeof archiveRef !== 'string' || archiveRef.trim() === '') {
      throw new TypeError('updateArchiveRef requires a non-empty archiveRef.');
    }
    if (typeof retentionUntil !== 'string' || retentionUntil.trim() === '') {
      throw new TypeError('updateArchiveRef requires a non-empty retentionUntil.');
    }
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE document_registry SET archive_ref = ?, retention_until = ?, updated_at = ? WHERE doc_id = ?')
      .run(archiveRef, retentionUntil, now, docId);
    if (result.changes === 0) {
      throw new Error(`Cannot update archiveRef: no registry row for docId ${docId}.`);
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
      ruleId: doc.rule_id,
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
