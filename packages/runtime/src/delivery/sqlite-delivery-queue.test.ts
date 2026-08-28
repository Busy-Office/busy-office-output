/**
 * SqliteDeliveryQueue (ROADMAP Stage 3, "Delivery queue: retry w/ backoff ->
 * terminal poison + alert; never re-render on delivery failure"). The DoD
 * test below is the point of this whole task: kill the channel, drive
 * retries to poison, and prove the archived artifact was never touched —
 * no re-render, no re-archive, byte-identical retrieve() before and after.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessEventKey } from '@busy-office/output-schema';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import type { RegistryStore } from '../registry/registry-store.js';
import { FsArchiveStore } from '../archive/fs-archive-store.js';
import { archiveArtifact } from '../archive/index.js';
import type { ChannelSendInput, ChannelSender } from './channel-sender.js';
import { computeBackoffMs, DEFAULT_BACKOFF_POLICY } from './delivery-queue.js';
import { createSqliteDeliveryQueue, SqliteDeliveryQueue } from './sqlite-delivery-queue.js';

function key(overrides: Partial<BusinessEventKey> = {}): BusinessEventKey {
  return {
    businessObject: 'EKKO',
    businessObjectId: '4500009999',
    event: 'po.released',
    templateVersion: '1.0.0',
    ...overrides,
  };
}

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** A ChannelSender that always throws — "kill the channel" for the DoD. */
class AlwaysFailingSender implements ChannelSender {
  public calls: ChannelSendInput[] = [];
  async send(input: ChannelSendInput): Promise<void> {
    this.calls.push(input);
    throw new Error('channel is dead (simulated)');
  }
}

class AlwaysSucceedingSender implements ChannelSender {
  public calls: ChannelSendInput[] = [];
  async send(input: ChannelSendInput): Promise<void> {
    this.calls.push(input);
  }
}

interface Fixture {
  dbPath: string;
  registryStore: RegistryStore;
  archiveStore: FsArchiveStore;
  docId: string;
  archiveRef: string;
  originalBytes: Uint8Array;
}

async function setUpArchivedArtifact(): Promise<Fixture> {
  const dbDir = tempDir('delivery-queue-test-');
  const dbPath = join(dbDir, 'registry.db');
  const archiveRoot = tempDir('delivery-queue-archive-');

  const registryStore = createSqliteRegistryStore(dbPath);
  const archiveStore = new FsArchiveStore(archiveRoot);

  const { row } = registryStore.getOrCreateByEventKey(key({ businessObjectId: randomUUID() }));
  const originalBytes = new TextEncoder().encode('%PDF-1.7 fake artifact bytes for delivery queue test');

  const archiveRef = await archiveArtifact({
    archiveStore,
    registryStore,
    docId: row.docId,
    bytes: originalBytes,
    mediaType: 'application/pdf',
    retentionUntil: '2030-01-01T00:00:00Z',
  });

  return { dbPath, registryStore, archiveStore, docId: row.docId, archiveRef, originalBytes };
}

describe('computeBackoffMs', () => {
  it('doubles from baseDelayMs and caps at maxDelayMs', () => {
    const policy = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 60_000 };
    expect(computeBackoffMs(1, policy)).toBe(1000);
    expect(computeBackoffMs(2, policy)).toBe(2000);
    expect(computeBackoffMs(3, policy)).toBe(4000);
    expect(computeBackoffMs(4, policy)).toBe(8000);
    expect(computeBackoffMs(10, policy)).toBe(60_000); // capped
  });

  it('DEFAULT_BACKOFF_POLICY is exported and usable with no overrides', () => {
    expect(computeBackoffMs(1)).toBe(DEFAULT_BACKOFF_POLICY.baseDelayMs);
  });
});

describe('SqliteDeliveryQueue', () => {
  it('enqueue() rejects an unknown docId', async () => {
    const { dbPath, registryStore, archiveStore } = await setUpArchivedArtifact();
    const queue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore });
    expect(() => queue.enqueue({ docId: 'not-a-real-doc-id', channel: 'email', recipients: ['a@example.com'] })).toThrow();
    queue.close();
    registryStore.close();
  });

  it('enqueue() mints a pending job immediately due', async () => {
    const { dbPath, registryStore, archiveStore, docId } = await setUpArchivedArtifact();
    const queue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore });

    const job = queue.enqueue({ docId, channel: 'email', recipients: ['ap@example.com'] });

    expect(job.status).toBe('pending');
    expect(job.attemptCount).toBe(0);
    expect(job.recipients).toEqual(['ap@example.com']);
    expect(queue.listDue()).toHaveLength(1);
    expect(queue.listDue()[0].id).toBe(job.id);

    queue.close();
    registryStore.close();
  });

  it('a successful delivery marks the job delivered and appends one delivery_history row', async () => {
    const { dbPath, registryStore, archiveStore, docId } = await setUpArchivedArtifact();
    const queue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore });
    const sender = new AlwaysSucceedingSender();

    const job = queue.enqueue({ docId, channel: 'email', recipients: ['ap@example.com'] });
    const result = await queue.attemptDelivery(job.id, sender);

    expect(result.outcome).toBe('delivered');
    expect(result.job.status).toBe('delivered');
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0].docId).toBe(docId);

    const history = registryStore.getByDocId(docId)!.deliveryHistory;
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('delivered');

    queue.close();
    registryStore.close();
  });

  it('DoD: kill the channel, drive to poison, artifact untouched', async () => {
    const { dbPath, registryStore, archiveStore, docId, archiveRef, originalBytes } = await setUpArchivedArtifact();

    // Snapshot bytes BEFORE any delivery attempt, independently of the
    // queue, so the final assertion cannot be trivially true.
    const beforeAttempts = await archiveStore.retrieve(archiveRef);
    expect(Buffer.from(beforeAttempts)).toEqual(Buffer.from(originalBytes));

    const backoffPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 };
    const onPoisonAlert = vi.fn();
    const queue = new SqliteDeliveryQueue(dbPath, { registryStore, archiveStore, backoffPolicy, onPoisonAlert });
    const deadChannel = new AlwaysFailingSender();

    const job = queue.enqueue({ docId, channel: 'email', recipients: ['ap@example.com'] });

    // Drive attempts directly (bypassing the next_attempt_at gate, which
    // is `processNext`'s concern, not `attemptDelivery`'s) until the job
    // reaches its terminal poison state.
    let result = await queue.attemptDelivery(job.id, deadChannel);
    expect(result.outcome).toBe('retry_scheduled');
    expect(result.job.status).toBe('pending');
    expect(result.job.attemptCount).toBe(1);

    result = await queue.attemptDelivery(job.id, deadChannel);
    expect(result.outcome).toBe('retry_scheduled');
    expect(result.job.attemptCount).toBe(2);

    result = await queue.attemptDelivery(job.id, deadChannel);
    expect(result.outcome).toBe('poisoned');
    expect(result.job.status).toBe('poison');
    expect(result.job.attemptCount).toBe(3);

    // (a) job status is poison
    expect(queue.getJob(job.id)?.status).toBe('poison');

    // (b) a poison query surfaces it
    const poisonJobs = queue.listPoisonJobs();
    expect(poisonJobs).toHaveLength(1);
    expect(poisonJobs[0].id).toBe(job.id);
    expect(poisonJobs[0].docId).toBe(docId);

    // structured alert fired exactly once, on the terminal attempt, with
    // no payload fields (docId/jobId/channel/attemptCount only).
    expect(onPoisonAlert).toHaveBeenCalledTimes(1);
    expect(onPoisonAlert).toHaveBeenCalledWith({
      jobId: job.id,
      docId,
      channel: 'email',
      attemptCount: 3,
    });

    // (c) delivery_history has one row per attempt (3), all reflecting
    // failure, the last one 'poisoned'.
    const history = registryStore.getByDocId(docId)!.deliveryHistory;
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.status)).toEqual(['failed', 'failed', 'poisoned']);
    for (const h of history) {
      expect(h.channel).toBe('email');
      expect(h.detail).toContain('channel is dead');
    }

    // The dead channel really was invoked every time (proves attempts
    // actually happened, not skipped).
    expect(deadChannel.calls).toHaveLength(3);

    // (d) THE CORE GUARANTEE: the archived artifact is byte-identical to
    // what was archived before any delivery attempt. Never re-rendered,
    // never re-archived, never touched by the failing/dead channel.
    const afterPoison = await archiveStore.retrieve(archiveRef);
    expect(Buffer.from(afterPoison)).toEqual(Buffer.from(originalBytes));
    expect(Buffer.from(afterPoison)).toEqual(Buffer.from(beforeAttempts));

    // And the registry row itself still points at the same, unchanged
    // archiveRef/retentionUntil/state — poisoning delivery does not touch
    // the artifact's own registry record either.
    const finalDoc = registryStore.getByDocId(docId)!;
    expect(finalDoc.archiveRef).toBe(archiveRef);
    expect(finalDoc.state).toBe('ORIGINAL');
    expect(finalDoc.retentionUntil).toBe('2030-01-01T00:00:00Z');

    queue.close();
    registryStore.close();
  });

  it('attemptDelivery throws for an unarchived docId (archiveRef null)', async () => {
    const { dbPath, registryStore, archiveStore } = await setUpArchivedArtifact();
    const queue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore });

    // A fresh DRAFT row with no archiveRef yet.
    const { row } = registryStore.getOrCreateByEventKey(key({ businessObjectId: randomUUID() }));
    const job = queue.enqueue({ docId: row.docId, channel: 'email', recipients: ['ap@example.com'] });

    await expect(queue.attemptDelivery(job.id, new AlwaysSucceedingSender())).rejects.toThrow(/archiveRef/);

    queue.close();
    registryStore.close();
  });

  it('processNext() only picks up jobs whose next_attempt_at is due', async () => {
    const { dbPath, registryStore, archiveStore, docId } = await setUpArchivedArtifact();
    const queue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore });
    const sender = new AlwaysSucceedingSender();

    queue.enqueue({ docId, channel: 'email', recipients: ['ap@example.com'] });

    const farFuture = new Date(Date.now() + 3_600_000).toISOString();
    const result = await queue.processNext(sender, farFuture);
    expect(result).toBeDefined();
    expect(result?.outcome).toBe('delivered');

    // Nothing else due now — the job just delivered, no more pending rows.
    const second = await queue.processNext(sender, farFuture);
    expect(second).toBeUndefined();

    queue.close();
    registryStore.close();
  });

  describe('listJobs()', () => {
    /** A sender whose `send()` never resolves until the test calls
     * `resolve()` — lets a test observe a job while it is genuinely
     * `in_progress` (set synchronously before the awaited send), rather
     * than racing a real async call. */
    class BlockingSender implements ChannelSender {
      public calls: ChannelSendInput[] = [];
      private resolveFn: (() => void) | undefined;
      send(input: ChannelSendInput): Promise<void> {
        this.calls.push(input);
        return new Promise((resolve) => {
          this.resolveFn = resolve;
        });
      }
      release(): void {
        this.resolveFn?.();
      }
    }

    async function buildFixture() {
      const { dbPath, registryStore, archiveStore, docId: firstDocId } = await setUpArchivedArtifact();
      const queue = new SqliteDeliveryQueue(dbPath, {
        registryStore,
        archiveStore,
        backoffPolicy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
        onPoisonAlert: () => {},
      });

      async function mintExtraDoc(): Promise<string> {
        const { row } = registryStore.getOrCreateByEventKey(key({ businessObjectId: randomUUID() }));
        await archiveArtifact({
          archiveStore,
          registryStore,
          docId: row.docId,
          bytes: new TextEncoder().encode('%PDF-1.7 fake bytes'),
          mediaType: 'application/pdf',
          retentionUntil: '2030-01-01T00:00:00Z',
        });
        return row.docId;
      }

      // Poison job (channel: email).
      const poisonDocId = firstDocId;
      const poisonJob = queue.enqueue({ docId: poisonDocId, channel: 'email', recipients: ['a@example.com'] });
      const poisonResult = await queue.attemptDelivery(poisonJob.id, new AlwaysFailingSender());
      expect(poisonResult.outcome).toBe('poisoned');

      // Delivered job (channel: webhook).
      const deliveredDocId = await mintExtraDoc();
      const deliveredJob = queue.enqueue({ docId: deliveredDocId, channel: 'webhook', recipients: ['b@example.com'] });
      const deliveredResult = await queue.attemptDelivery(deliveredJob.id, new AlwaysSucceedingSender());
      expect(deliveredResult.outcome).toBe('delivered');

      // Pending job, never attempted (channel: email).
      const pendingDocId = await mintExtraDoc();
      const pendingJob = queue.enqueue({ docId: pendingDocId, channel: 'email', recipients: ['c@example.com'] });

      // In-progress job (channel: webhook) — attemptDelivery started but
      // deliberately never resolved yet.
      const inProgressDocId = await mintExtraDoc();
      const inProgressJob = queue.enqueue({ docId: inProgressDocId, channel: 'webhook', recipients: ['d@example.com'] });
      const blockingSender = new BlockingSender();
      const inProgressAttempt = queue.attemptDelivery(inProgressJob.id, blockingSender);
      // Wait for the attempt to actually reach `send()` (past the
      // archiveStore.retrieve await, which is real async file I/O) before
      // returning, so a caller's later `blockingSender.release()` has a
      // `resolveFn` to call.
      while (blockingSender.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      return {
        queue,
        registryStore,
        blockingSender,
        inProgressAttempt,
        poisonJob,
        deliveredJob,
        pendingJob,
        inProgressJob,
      };
    }

    it('filters by an explicit statuses list', async () => {
      const { queue, registryStore, blockingSender, inProgressAttempt, poisonJob } = await buildFixture();

      const poisonOnly = queue.listJobs({ statuses: ['poison'], limit: 10, offset: 0 });
      expect(poisonOnly.map((j) => j.id)).toEqual([poisonJob.id]);

      blockingSender.release();
      await inProgressAttempt;
      queue.close();
      registryStore.close();
    });

    it('search matches docId and channel (substring, case-insensitive-by-LIKE)', async () => {
      const { queue, registryStore, blockingSender, inProgressAttempt, poisonJob, pendingJob, deliveredJob } =
        await buildFixture();

      const byChannel = queue.listJobs({ search: 'webhook', limit: 10, offset: 0 });
      expect(byChannel.map((j) => j.channel)).toEqual(['webhook', 'webhook']);

      const byDocId = queue.listJobs({ search: poisonJob.docId, limit: 10, offset: 0 });
      expect(byDocId.map((j) => j.id)).toEqual([poisonJob.id]);

      // sanity: pendingJob/deliveredJob docIds don't collide with the search above
      expect(pendingJob.docId).not.toBe(poisonJob.docId);
      expect(deliveredJob.docId).not.toBe(poisonJob.docId);

      blockingSender.release();
      await inProgressAttempt;
      queue.close();
      registryStore.close();
    });

    it('sorts worst-first: poison, then in_progress, then pending (by nextAttemptAt), delivered last', async () => {
      const { queue, registryStore, blockingSender, inProgressAttempt, poisonJob, deliveredJob, pendingJob, inProgressJob } =
        await buildFixture();

      // No statuses filter -> every status, including delivered.
      const all = queue.listJobs({ limit: 10, offset: 0 });
      expect(all.map((j) => j.id)).toEqual([poisonJob.id, inProgressJob.id, pendingJob.id, deliveredJob.id]);
      expect(all.map((j) => j.status)).toEqual(['poison', 'in_progress', 'pending', 'delivered']);

      blockingSender.release();
      await inProgressAttempt;
      queue.close();
      registryStore.close();
    });

    it('respects limit/offset pagination', async () => {
      const { queue, registryStore, blockingSender, inProgressAttempt, poisonJob, inProgressJob } = await buildFixture();

      const firstPage = queue.listJobs({ limit: 1, offset: 0 });
      expect(firstPage.map((j) => j.id)).toEqual([poisonJob.id]);

      const secondPage = queue.listJobs({ limit: 1, offset: 1 });
      expect(secondPage.map((j) => j.id)).toEqual([inProgressJob.id]);

      blockingSender.release();
      await inProgressAttempt;
      queue.close();
      registryStore.close();
    });
  });
});
