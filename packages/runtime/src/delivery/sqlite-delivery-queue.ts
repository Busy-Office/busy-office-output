/**
 * SqliteDeliveryQueue: the default embedded `DeliveryQueue` implementation
 * (ROADMAP Stage 3, ADR-004 Option 1 — SQLite-backed embedded queue).
 * Mirrors `SqliteRegistryStore`'s shape: `node:sqlite` (`DatabaseSync`) via
 * `createRequire` (see that file's comment for why not a static import),
 * migrations run on every construction so a fresh file or `:memory:`
 * database is always immediately usable, one file = one embedded database.
 *
 * Opens its OWN connection to the same SQLite file the registry uses
 * (WAL mode allows concurrent connections to one file) rather than sharing
 * `SqliteRegistryStore`'s internal `DatabaseSync` handle — that handle
 * isn't exposed across the port boundary, and every write this class makes
 * to `delivery_queue` is followed by a call through the injected
 * `RegistryStore` port (`appendDeliveryEvent`) for `delivery_history`, so
 * the two tables never need a shared transaction to stay consistent with
 * each other; each write is its own atomic statement.
 *
 * Depends on `RegistryStore` (to read `archiveRef` and to append
 * `delivery_history` rows — CLAUDE.md: registry row per artifact, full
 * delivery history) and `ArchiveStore` (to read back already-archived
 * bytes — NEVER to re-render or re-archive; see delivery-queue.ts's
 * module comment for the core guarantee this enforces).
 */
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};
import { runMigrations } from '../registry/migrate.js';
import type { RegistryStore } from '../registry/registry-store.js';
import type { ArchiveStore } from '../archive/archive-store.js';
import type { ChannelSender } from './channel-sender.js';
import {
  DEFAULT_BACKOFF_POLICY,
  computeBackoffMs,
  type BackoffPolicy,
  type DeliveryAttemptResult,
  type DeliveryJob,
  type DeliveryJobStatus,
  type DeliveryQueue,
  type EnqueueDeliveryInput,
} from './delivery-queue.js';

interface DeliveryQueueRow {
  id: number;
  doc_id: string;
  channel: string;
  recipients: string;
  attempt_count: number;
  next_attempt_at: string;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function toJob(row: DeliveryQueueRow): DeliveryJob {
  return {
    id: row.id,
    docId: row.doc_id,
    channel: row.channel,
    recipients: JSON.parse(row.recipients) as string[],
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    status: row.status as DeliveryJobStatus,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SqliteDeliveryQueueOptions {
  registryStore: RegistryStore;
  archiveStore: ArchiveStore;
  backoffPolicy?: BackoffPolicy;
  /** Injectable for tests: called with a structured (payload-free) detail
   * object whenever a job reaches `poison`. Defaults to a single
   * `console.error` line — CLAUDE.md: no payloads in logs, so this only
   * ever receives docId/jobId/channel/attemptCount, never bytes or
   * recipients. Not a real alerting integration (out of scope). */
  onPoisonAlert?: (alert: PoisonAlert) => void;
}

export interface PoisonAlert {
  jobId: number;
  docId: string;
  channel: string;
  attemptCount: number;
}

function defaultOnPoisonAlert(alert: PoisonAlert): void {
  // Structured, payload-free line: docId/jobId/channel/attemptCount only.
  // eslint-disable-next-line no-console
  console.error('[delivery-queue] ALERT poison', alert);
}

export class SqliteDeliveryQueue implements DeliveryQueue {
  private readonly db: DatabaseSyncType;
  private readonly registryStore: RegistryStore;
  private readonly archiveStore: ArchiveStore;
  private readonly backoffPolicy: BackoffPolicy;
  private readonly onPoisonAlert: (alert: PoisonAlert) => void;

  constructor(dbPath: string, options: SqliteDeliveryQueueOptions) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    runMigrations(this.db);
    this.registryStore = options.registryStore;
    this.archiveStore = options.archiveStore;
    this.backoffPolicy = options.backoffPolicy ?? DEFAULT_BACKOFF_POLICY;
    this.onPoisonAlert = options.onPoisonAlert ?? defaultOnPoisonAlert;
  }

  enqueue(input: EnqueueDeliveryInput): DeliveryJob {
    if (typeof input.docId !== 'string' || input.docId.trim() === '') {
      throw new TypeError('enqueue requires a non-empty docId.');
    }
    if (typeof input.channel !== 'string' || input.channel.trim() === '') {
      throw new TypeError('enqueue requires a non-empty channel.');
    }
    if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
      throw new TypeError('enqueue requires at least one recipient.');
    }
    // Fail loudly on an unknown docId rather than silently queuing a job
    // that can never be delivered — mirrors RegistryStore's own
    // "throws if docId does not exist" convention.
    if (this.registryStore.getByDocId(input.docId) === undefined) {
      throw new Error(`Cannot enqueue delivery: no registry row for docId ${input.docId}.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO delivery_queue
           (doc_id, channel, recipients, attempt_count, next_attempt_at, status, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 'pending', ?, ?)`,
      )
      .run(input.docId, input.channel, JSON.stringify(input.recipients), now, now, now);

    const row = this.db.prepare('SELECT * FROM delivery_queue WHERE id = last_insert_rowid()').get() as
      | DeliveryQueueRow
      | undefined;
    if (row === undefined) {
      throw new Error('Delivery job insert did not become readable.');
    }
    return toJob(row);
  }

  getJob(id: number): DeliveryJob | undefined {
    const row = this.selectById(id);
    return row === undefined ? undefined : toJob(row);
  }

  listPoisonJobs(): DeliveryJob[] {
    const rows = this.db
      .prepare('SELECT * FROM delivery_queue WHERE status = ? ORDER BY id ASC')
      .all('poison') as unknown as DeliveryQueueRow[];
    return rows.map(toJob);
  }

  listDue(now: string = new Date().toISOString()): DeliveryJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM delivery_queue WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at ASC`,
      )
      .all(now) as unknown as DeliveryQueueRow[];
    return rows.map(toJob);
  }

  listJobs(options: { search?: string; statuses?: DeliveryJobStatus[]; limit: number; offset: number }): DeliveryJob[] {
    const search = options.search?.trim() ?? '';
    const { limit, offset } = options;

    const conditions: string[] = [];
    const params: string[] = [];

    if (options.statuses !== undefined && options.statuses.length > 0) {
      conditions.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
      params.push(...options.statuses);
    }

    if (search !== '') {
      const like = `%${search}%`;
      conditions.push('(doc_id LIKE ? OR channel LIKE ?)');
      params.push(like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Worst-first: poison, then in_progress, then pending (by nextAttemptAt
    // ascending), everything else (delivered) last; id ascending breaks
    // ties within a bucket.
    const sql = `SELECT * FROM delivery_queue ${where}
      ORDER BY
        CASE status WHEN 'poison' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
        next_attempt_at ASC,
        id ASC
      LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params, limit, offset) as unknown as DeliveryQueueRow[];
    return rows.map(toJob);
  }

  async attemptDelivery(jobId: number, sender: ChannelSender): Promise<DeliveryAttemptResult> {
    const row = this.selectById(jobId);
    if (row === undefined) {
      throw new Error(`Cannot attempt delivery: no delivery_queue row for id ${jobId}.`);
    }
    const job = toJob(row);

    const doc = this.registryStore.getByDocId(job.docId);
    if (doc === undefined) {
      throw new Error(`Cannot attempt delivery: no registry row for docId ${job.docId}.`);
    }
    if (doc.archiveRef === null) {
      throw new Error(`Cannot attempt delivery: docId ${job.docId} has not been archived yet (archiveRef is null).`);
    }

    this.setStatus(job.id, 'in_progress');

    // The core guarantee: read already-archived bytes back. Never render,
    // compose, or determine again. A throw here (e.g. corrupted/missing
    // archive) is a different failure class from a channel failure, but is
    // still handled by the same retry/poison path below — it never
    // triggers re-render either.
    let archiveBytes: Uint8Array;
    try {
      archiveBytes = await this.archiveStore.retrieve(doc.archiveRef);
    } catch (err) {
      return this.recordFailure(job, err);
    }

    try {
      await sender.send({
        archiveBytes,
        recipients: job.recipients,
        channel: job.channel,
        docId: job.docId,
      });
    } catch (err) {
      return this.recordFailure(job, err);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE delivery_queue SET status = 'delivered', updated_at = ? WHERE id = ?`)
      .run(now, job.id);
    this.registryStore.appendDeliveryEvent(job.docId, {
      channel: job.channel,
      status: 'delivered',
      occurredAt: now,
    });

    const updated = this.selectById(job.id);
    if (updated === undefined) {
      throw new Error(`Delivery job ${job.id} vanished after update.`);
    }
    return { job: toJob(updated), outcome: 'delivered' };
  }

  async processNext(sender: ChannelSender, now?: string): Promise<DeliveryAttemptResult | undefined> {
    const due = this.listDue(now);
    if (due.length === 0) {
      return undefined;
    }
    return this.attemptDelivery(due[0].id, sender);
  }

  close(): void {
    this.db.close();
  }

  private recordFailure(job: DeliveryJob, err: unknown): DeliveryAttemptResult {
    const attemptCount = job.attemptCount + 1;
    const message = err instanceof Error ? err.message : String(err);
    const now = new Date().toISOString();

    if (attemptCount >= this.backoffPolicy.maxAttempts) {
      this.db
        .prepare(
          `UPDATE delivery_queue
             SET status = 'poison', attempt_count = ?, last_error = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(attemptCount, message, now, job.id);
      this.registryStore.appendDeliveryEvent(job.docId, {
        channel: job.channel,
        status: 'poisoned',
        occurredAt: now,
        detail: message,
      });
      this.onPoisonAlert({ jobId: job.id, docId: job.docId, channel: job.channel, attemptCount });

      const updated = this.selectById(job.id);
      if (updated === undefined) {
        throw new Error(`Delivery job ${job.id} vanished after update.`);
      }
      return { job: toJob(updated), outcome: 'poisoned' };
    }

    const delayMs = computeBackoffMs(attemptCount, this.backoffPolicy);
    const nextAttemptAt = new Date(Date.parse(now) + delayMs).toISOString();
    this.db
      .prepare(
        `UPDATE delivery_queue
           SET status = 'pending', attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(attemptCount, nextAttemptAt, message, now, job.id);
    this.registryStore.appendDeliveryEvent(job.docId, {
      channel: job.channel,
      status: 'failed',
      occurredAt: now,
      detail: message,
    });

    const updated = this.selectById(job.id);
    if (updated === undefined) {
      throw new Error(`Delivery job ${job.id} vanished after update.`);
    }
    return { job: toJob(updated), outcome: 'retry_scheduled' };
  }

  private setStatus(id: number, status: DeliveryJobStatus): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE delivery_queue SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  private selectById(id: number): DeliveryQueueRow | undefined {
    return this.db.prepare('SELECT * FROM delivery_queue WHERE id = ?').get(id) as DeliveryQueueRow | undefined;
  }
}

export function createSqliteDeliveryQueue(dbPath: string, options: SqliteDeliveryQueueOptions): DeliveryQueue {
  return new SqliteDeliveryQueue(dbPath, options);
}
