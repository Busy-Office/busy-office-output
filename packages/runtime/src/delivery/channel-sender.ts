/**
 * ChannelSender port. Deliberately
 * the SMALLEST possible seam between the delivery-queue mechanics and
 * actual channel implementations (email, object-store, ...) — those are
 * built separately, in their own files, never here.
 * `SqliteDeliveryQueue` depends only on this interface; tests inject
 * fakes (including one that always throws, to simulate "kill the channel"
 * for the poison-path DoD) and never touch a real channel.
 *
 * No payloads in logs (CLAUDE.md golden rule): a `ChannelSender`
 * implementation receives the archived bytes directly (it has to, to
 * deliver them) but nothing in the delivery-queue mechanics ever logs
 * `input.archiveBytes` or `input.recipients` — only docId/channel/jobId/
 * attemptCount/hashes are ever appropriate to log, and this port itself
 * doesn't log at all.
 */

/** Input to one delivery attempt via a channel. */
export interface ChannelSendInput {
  /** The artifact's bytes, read back from the archive — never re-rendered. */
  archiveBytes: Uint8Array;
  /** Opaque recipient addresses; the queue does not interpret these. */
  recipients: string[];
  /** The channel name this job was enqueued against, e.g. "email". */
  channel: string;
  /** The registry docId this delivery is for. */
  docId: string;
  /** The rendered subject/body off the delivery job — evaluated
   * at enqueue from the resolved message template, never here. Present
   * for channels that carry a message (email); a sender for such a channel
   * refuses a job without one rather than inventing a default. PII:
   * never logged. */
  message?: { subject: string; body: string };
}

/**
 * Backend-agnostic delivery channel. `send` resolves on success and
 * rejects (throws) on any failure — the queue's retry/backoff/poison
 * machinery is driven entirely by whether the returned promise settles or
 * rejects, nothing else.
 */
export interface ChannelSender {
  send(input: ChannelSendInput): Promise<void>;
}
