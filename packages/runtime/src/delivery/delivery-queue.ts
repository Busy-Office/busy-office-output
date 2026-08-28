/**
 * DeliveryQueue port (ROADMAP Stage 3, "Delivery queue: retry w/ backoff ->
 * terminal poison + alert; never re-render on delivery failure").
 * Backend-agnostic on purpose — same pattern as `RegistryStore` and
 * `ArchiveStore` (ADR-004: SQLite-backed embedded implementation now, an
 * external-backend adapter reserved for later, gated behind this same
 * interface). `SqliteDeliveryQueue` (sqlite-delivery-queue.ts) is the only
 * implementation right now.
 *
 * Core guarantee this port exists to make impossible to violate: delivery
 * failure never triggers re-render. Every method here operates on
 * already-archived bytes (read back via `ArchiveStore.retrieve`) and a
 * `ChannelSender` — nothing in this file's surface can call into
 * rendering, composition, or determination. A failing channel can only
 * ever change THIS row's `status`/`attemptCount`/`lastError`; the artifact
 * an implementation reads from the archive is never rewritten.
 *
 * Deliberately NOT here (see the task's scope boundary): real channels
 * (Channels task, next), a long-running poller loop that continuously
 * drains due jobs (the `serve` worker loop, later task) — this port
 * provides `attemptDelivery`/`processNext` as a single processing STEP,
 * not a runner.
 */

/**
 * pending: queued or awaiting its next retry (`nextAttemptAt` in the
 *   future, or now, depending on when it's read).
 * in_progress: an attempt is currently running against this job (set for
 *   the duration of `attemptDelivery`, so a crash mid-attempt is visible
 *   rather than silently looking like an untouched `pending` row).
 * delivered: terminal, success.
 * poison: terminal, retries exhausted. Never deleted — the row stays
 *   queryable forever (CLAUDE.md: audit is not optional), and this is the
 *   state the DoD's "poison row/query surfaces it" assertion targets.
 */
export type DeliveryJobStatus = 'pending' | 'in_progress' | 'delivered' | 'poison';

/** One delivery job — a docId's delivery to one channel/recipient set. */
export interface DeliveryJob {
  id: number;
  docId: string;
  channel: string;
  recipients: string[];
  attemptCount: number;
  /** RFC 3339 timestamp: this job is not eligible for another attempt
   * before this instant. Set at enqueue time (to the enqueue instant, so
   * a brand-new job is immediately due) and advanced by backoff after
   * every failed attempt. */
  nextAttemptAt: string;
  status: DeliveryJobStatus;
  /** The most recent attempt's error message. Null until a failure has
   * occurred. Never the full stack/payload — a short message only (no
   * payloads in logs applies here too: this column is queried and
   * potentially surfaced in the console, not a dumping ground). */
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueDeliveryInput {
  docId: string;
  channel: string;
  recipients: string[];
}

/** Outcome of one call to `attemptDelivery`. */
export type DeliveryAttemptOutcome = 'delivered' | 'retry_scheduled' | 'poisoned';

export interface DeliveryAttemptResult {
  job: DeliveryJob;
  outcome: DeliveryAttemptOutcome;
}

/**
 * Backoff policy for retries between failed attempts.
 * `computeBackoffMs` (this module) implements it: exponential with a cap,
 * `delayMs = min(baseDelayMs * 2^(attemptsMade - 1), maxDelayMs)`.
 */
export interface BackoffPolicy {
  /** Attempts (including the first) before a job becomes poison. */
  maxAttempts: number;
  /** Delay before the 2nd attempt, in milliseconds. */
  baseDelayMs: number;
  /** Backoff never exceeds this, in milliseconds. */
  maxDelayMs: number;
}

/**
 * Default policy: 5 attempts total (1 initial + 4 retries), starting at a
 * 1s delay, doubling each time, capped at 60s
 * (1s, 2s, 4s, 8s -> poison on the 5th failure). Deliberately small
 * absolute numbers — real channel backoff timing is a product/ops call
 * above this task's pay grade; this default only needs to be sane for an
 * embedded single-process deployment and easy to override.
 */
export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
};

/** Exponential-with-cap backoff. `attemptsMade` is the attempt count
 * AFTER the failure being backed off from (i.e. 1 after the first
 * failure). Exported for tests to assert the exact formula. */
export function computeBackoffMs(attemptsMade: number, policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY): number {
  const delay = policy.baseDelayMs * 2 ** (attemptsMade - 1);
  return Math.min(delay, policy.maxDelayMs);
}

export interface DeliveryQueue {
  /** Insert a new pending job, immediately due. Does not attempt delivery. */
  enqueue(input: EnqueueDeliveryInput): DeliveryJob;

  /** Fetch a job by its id. Returns undefined if no such job exists. */
  getJob(id: number): DeliveryJob | undefined;

  /** Every job currently in the terminal `poison` state (DoD: "a poison
   * row/query surfaces it"). Never empties on its own — poison rows are
   * terminal and permanent. */
  listPoisonJobs(): DeliveryJob[];

  /** Jobs eligible for an attempt right now: `status = 'pending'` and
   * `nextAttemptAt <= now`. `now` defaults to the current instant; tests
   * pass an explicit value to avoid timing flakiness. */
  listDue(now?: string): DeliveryJob[];

  /**
   * Run ONE delivery attempt for `jobId` against `sender`: read the job's
   * archived bytes back via the archive store (never re-render), call
   * `sender.send`, and update the job's state accordingly —
   * `delivered` on success; `pending` with backoff-advanced
   * `nextAttemptAt` on failure below `maxAttempts`; `poison` (terminal,
   * with a structured alert log line) on failure at `maxAttempts`.
   * Always appends one row to the registry's `delivery_history` for this
   * attempt (success or failure), via `RegistryStore.appendDeliveryEvent`.
   * Throws if `jobId` does not exist, or if the job's docId has no
   * archived artifact yet (`archiveRef` is null) — a job must not be
   * attempted before its artifact is archived.
   */
  attemptDelivery(jobId: number, sender: import('./channel-sender.js').ChannelSender): Promise<DeliveryAttemptResult>;

  /** Convenience: pick the single most-overdue due job (if any) and run
   * `attemptDelivery` on it. Returns undefined if no job is due. This is
   * ONE processing step, not a loop — callers (the later worker task)
   * are responsible for calling it repeatedly. */
  processNext(
    sender: import('./channel-sender.js').ChannelSender,
    now?: string,
  ): Promise<DeliveryAttemptResult | undefined>;

  /** Release the underlying connection/handle. Safe to call once, at shutdown. */
  close(): void;
}
