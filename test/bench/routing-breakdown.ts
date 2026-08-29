/**
 * Row-based per-recipient routing evidence (ROADMAP Stage 4 exit gate,
 * clause 2 "per-recipient locale and channel"): read straight from the
 * SQLite registry file — `document_registry.locale`
 * (migrations/0010_add_locale.sql) JOINed with `delivery_queue`
 * (channel + recipients JSON, 0004) — never from in-process return values,
 * so what is asserted is what is durably on disk. Shared by the bench
 * (`bursting.ts`, prints it for the 8,000 run) and the permanent gate test
 * (`per-recipient-routing.test.ts`, asserts on it at small N inside
 * `npm test`).
 *
 * Recipients are read here ONLY to count distinct values; they are never
 * returned individually or printed — the bench output goes to a terminal.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export interface RoutingCell {
  locale: string | null;
  channel: string;
  rows: number;
  distinctRecipients: number;
}

export interface RoutingSummary {
  cells: RoutingCell[];
  registryRows: number;
  deliveryJobs: number;
  traceRows: number;
  /** Count of DISTINCT recipient lists across every email-channel delivery
   * job — equals the email job count iff every doc went to its own mailbox. */
  distinctEmailRecipients: number;
  emailJobs: number;
}

export function summarizeRouting(dbPath: string): RoutingSummary {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const cells = db
      .prepare(
        `SELECT r.locale AS locale, q.channel AS channel, COUNT(*) AS rows, COUNT(DISTINCT q.recipients) AS distinctRecipients
           FROM document_registry r JOIN delivery_queue q ON q.doc_id = r.doc_id
          GROUP BY r.locale, q.channel ORDER BY r.locale, q.channel`,
      )
      .all() as unknown as RoutingCell[];
    const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    return {
      cells: cells.map((c) => ({ ...c, rows: Number(c.rows), distinctRecipients: Number(c.distinctRecipients) })),
      registryRows: one('SELECT COUNT(*) AS n FROM document_registry'),
      deliveryJobs: one('SELECT COUNT(*) AS n FROM delivery_queue'),
      traceRows: one('SELECT COUNT(*) AS n FROM trace_log'),
      distinctEmailRecipients: one(`SELECT COUNT(DISTINCT recipients) AS n FROM delivery_queue WHERE channel = 'email'`),
      emailJobs: one(`SELECT COUNT(*) AS n FROM delivery_queue WHERE channel = 'email'`),
    };
  } finally {
    db.close();
  }
}
