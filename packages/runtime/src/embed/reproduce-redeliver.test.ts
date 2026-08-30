/**
 * GAP-22: `reproduce` gains an optional additive redelivery.
 *
 * Real `OutputPort.reproduce` (create-output.ts) against a real
 * `SqliteRegistryStore` + `SqliteDeliveryQueue` sharing one on-disk
 * database file, and a real `FsArchiveStore` — bytes are minted directly
 * via `archiveArtifact` (the same no-renderer shortcut
 * `document-detail-reproduce.test.ts` and `overview-settings.test.ts`
 * use), so this stays fast while `reproduce` and `DeliveryQueue.enqueue`
 * both run for real, no fakes.
 *
 * Proves two things: `deliverTo` genuinely inserts a `pending` row into
 * the delivery queue's backing store (not just a type that compiles), and
 * omitting `deliverTo` leaves today's bytes-only behavior exactly as it
 * was — no delivery job appears.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import type { RegistryStore } from '../registry/registry-store.js';
import { FsArchiveStore } from '../archive/fs-archive-store.js';
import { archiveArtifact } from '../archive/index.js';
import { createSqliteDeliveryQueue } from '../delivery/sqlite-delivery-queue.js';
import type { DeliveryQueue } from '../delivery/delivery-queue.js';
import { createOutput } from './create-output.js';

describe('OutputPort.reproduce — optional redelivery (GAP-22)', () => {
  const tempDirs: string[] = [];
  const closers: Array<() => void> = [];
  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }
  afterEach(() => {
    while (closers.length > 0) closers.pop()?.();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  function buildFixture() {
    const dbPath = join(tempDir('reproduce-redeliver-db-'), 'registry.db');
    const registryStore: RegistryStore = createSqliteRegistryStore(dbPath);
    const archiveStore = new FsArchiveStore(tempDir('reproduce-redeliver-archive-'));
    const deliveryQueue: DeliveryQueue = createSqliteDeliveryQueue(dbPath, { registryStore, archiveStore });
    const output = createOutput({ registryStore, archiveStore, deliveryQueue });
    closers.push(() => {
      deliveryQueue.close();
      registryStore.close();
    });

    let seq = 0;
    /** Mints an ARCHIVED row directly (no render). */
    async function mintArchived(): Promise<string> {
      seq += 1;
      const { row } = registryStore.getOrCreateByResolutionKey(
        { businessObject: 'OBJ', businessObjectId: `id-${seq}`, event: 'issued', templateVersion: '1.0.0', ruleId: `r${seq}` },
        'purchase-order',
      );
      await archiveArtifact({
        archiveStore,
        registryStore,
        docId: row.docId,
        bytes: new TextEncoder().encode(`%PDF-1.7 fake ${seq}`),
        mediaType: 'application/pdf',
        retentionUntil: '2030-01-01T00:00:00Z',
        renderer: { id: 'typst', version: '0.15.1' },
        inputHash: 'test-input-hash',
      });
      return row.docId;
    }

    return { registryStore, deliveryQueue, output, mintArchived };
  }

  it('deliverTo present: a pending object-store delivery job appears in the queue backing store for the reproduced docId', async () => {
    const f = buildFixture();
    const docId = await f.mintArchived();

    const result = await f.output.reproduce({
      docId,
      actor: { subjectId: 'ops-1', role: 'console' },
      reason: 'redeliver to archive bucket',
      deliverTo: { channel: 'object-store', recipients: ['ops-bucket@example.com'] },
    });

    expect(result.status).toBe('reproduced');
    if (result.status !== 'reproduced') throw new Error('unreachable');
    expect(result.deliveryJobId).toBeDefined();

    const jobs = f.deliveryQueue.listJobs({ search: docId, limit: 10, offset: 0 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: result.deliveryJobId,
      docId,
      channel: 'object-store',
      recipients: ['ops-bucket@example.com'],
      status: 'pending',
    });

    // The audit trail is unchanged by the redelivery — still exactly one
    // reproduce stamp, additive, not replaced.
    const log = f.registryStore.listReprintLog(docId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ docId, action: 'reproduce', actorSubjectId: 'ops-1' });
  });

  it('deliverTo omitted: no delivery job is created (today\'s bytes-only behavior is unchanged)', async () => {
    const f = buildFixture();
    const docId = await f.mintArchived();

    const result = await f.output.reproduce({
      docId,
      actor: { subjectId: 'ops-1', role: 'console' },
      reason: 'bytes only',
    });

    expect(result.status).toBe('reproduced');
    if (result.status !== 'reproduced') throw new Error('unreachable');
    expect(result.deliveryJobId).toBeUndefined();

    const jobs = f.deliveryQueue.listJobs({ search: docId, limit: 10, offset: 0 });
    expect(jobs).toHaveLength(0);

    // The reprint_log stamp still happens exactly as before.
    const log = f.registryStore.listReprintLog(docId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ docId, action: 'reproduce', actorSubjectId: 'ops-1' });
  });
});
