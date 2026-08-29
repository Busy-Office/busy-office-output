/**
 * `createOutput()` (ROADMAP Stage 3 "Embeddable module (ADR-007)"):
 *  - the happy path (emit -> real render/archive/enqueue, replay
 *    returns the same docId without recomposing), and
 *  - THE rollback test that is this task's literal DoD: "rollback test
 *    shows no orphaned artifact or registry row" — simulating a crash
 *    between docId-mint and composition-complete (the transactional-outbox
 *    gap `mintWithOutbox` / `resumeStrandedCompositions` close), then
 *    proving recovery leaves no orphaned artifact bytes and no
 *    permanently-stuck registry row.
 *
 * Uses real backends (`createRuntimeDeps`, real `TypstRenderer`, real disk
 * paths) exactly like e2e.test.ts, so "no orphaned artifact bytes" is
 * checked against a REAL archive directory listing, not a mock.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeDeps, type RuntimeDeps } from '../index.js';
import { determine, type DeterminationContext } from '../determination/index.js';
import { composeRenderArchiveAndEnqueue } from '../composition.js';
import { createOutput, type OutputPort } from './create-output.js';
import { sampleBusinessEventKey, validPurchaseOrder } from '../fixtures.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Every file under an FsArchiveStore root, recursively (its two-hex-char
 * shard layout — see fs-archive-store.ts), excluding `.meta.json` sidecars. */
function listArchivedArtifactFiles(archiveDir: string): string[] {
  if (!existsSync(archiveDir)) return [];
  const files: string[] = [];
  for (const shard of readdirSync(archiveDir)) {
    const shardPath = join(archiveDir, shard);
    for (const name of readdirSync(shardPath)) {
      if (!name.endsWith('.meta.json')) {
        files.push(join(shard, name));
      }
    }
  }
  return files;
}

function buildOutput(deps: RuntimeDeps): OutputPort {
  return createOutput({
    registryStore: deps.registryStore,
    archiveStore: deps.archiveStore,
    deliveryQueue: deps.deliveryQueue,
    renderer: deps.composition.renderer,
    // The built-ins are registered in this registry (createRuntimeDeps
    // registers them through the port's own `registerDocumentType`).
    documentTypes: deps.documentTypes,
  });
}

describe('createOutput: happy path', () => {
  it('submits an event, renders+archives+enqueues, and a replay returns the same docId without recomposing', async () => {
    const dbPath = join(tempDir('create-output-db-'), 'registry.db');
    const deps = createRuntimeDeps(dbPath, tempDir('create-output-archive-'), tempDir('create-output-outbox-'));
    const output = buildOutput(deps);

    const businessEvent = sampleBusinessEventKey({ businessObjectId: 'CO-HAPPY-0001' });
    const submit = () =>
      output.emit({ documentType: 'purchase-order', payload: validPurchaseOrder(), businessEvent });

    const first = await submit();
    expect(first.status).toBe('accepted');
    if (first.status !== 'accepted') throw new Error('unreachable');
    const [firstResolution] = first.resolutions;
    expect(firstResolution.replayed).toBe(false);
    expect(firstResolution.composition).toMatchObject({ outcome: 'rendered' });

    const archiveDir = (deps.archiveStore as unknown as { rootDir: string }).rootDir;
    const filesAfterFirst = listArchivedArtifactFiles(archiveDir);
    expect(filesAfterFirst.length).toBe(1);

    const second = await submit();
    expect(second.status).toBe('accepted');
    if (second.status !== 'accepted') throw new Error('unreachable');
    const [secondResolution] = second.resolutions;
    expect(secondResolution.docId).toBe(firstResolution.docId);
    expect(secondResolution.replayed).toBe(true);
    expect(secondResolution.composition).toEqual({ outcome: 'replayed' });

    // Replay never re-rendered/re-archived: still exactly one file on disk.
    expect(listArchivedArtifactFiles(archiveDir).length).toBe(1);

    deps.deliveryQueue.close();
    deps.registryStore.close();
  }, 30_000);
});

describe('createOutput: rollback test — crash between mint and composition-complete', () => {
  it('a stranded mint (process died before composition ever started) resumes cleanly on restart: exactly one archived artifact, registry row reaches ORIGINAL, no duplicate on a second resume', async () => {
    const dbPath = join(tempDir('rollback-db-'), 'registry.db');
    const archiveDir = tempDir('rollback-archive-');
    const outboxDir = tempDir('rollback-outbox-');

    // --- "Before the crash": mint a docId + outbox row, but never even
    // start composition — this is the exact gap `mintWithOutbox` closes:
    // simulates the process dying between the mint call returning and
    // composeRenderArchiveAndEnqueue being invoked at all.
    const deps1 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    const businessEvent = sampleBusinessEventKey({ businessObjectId: 'CO-CRASH-0001' });
    const data = validPurchaseOrder();
    const ctx: DeterminationContext = {
      documentType: 'purchase-order',
      businessObject: businessEvent.businessObject,
      event: businessEvent.event,
    };
    const determination = determine(ctx, deps1.documentTypes.rules(), deps1.documentTypes.templateMetas());
    expect(determination.outcome).toBe('matched');
    if (determination.outcome !== 'matched') throw new Error('unreachable');
    const [resolution] = determination.resolutions;

    const { row, created } = deps1.registryStore.mintWithOutbox(
      { ...businessEvent, ruleId: resolution.ruleId },
      resolution,
      data,
    );
    expect(created).toBe(true);
    const docId = row.docId;

    // Nothing archived yet — the "crash" happened before any bytes were written.
    expect(listArchivedArtifactFiles(archiveDir)).toEqual([]);
    // The registry row is durably stuck DRAFT/unarchived, exactly as a real
    // crash would leave it.
    expect(deps1.registryStore.getByDocId(docId)?.state).toBe('DRAFT');
    expect(deps1.registryStore.getByDocId(docId)?.archiveRef).toBeNull();
    // But the outbox still knows this docId owes composition work.
    expect(deps1.registryStore.getOutboxEntry(docId)).toBeDefined();

    deps1.deliveryQueue.close();
    deps1.registryStore.close();

    // --- "Restart": a fresh process (fresh RuntimeDeps / createOutput)
    // reopens the SAME on-disk registry + archive.
    const deps2 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    const output2 = buildOutput(deps2);

    const resumed = await output2.resumeStrandedCompositions();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ docId, skipped: false });
    if (resumed[0].skipped) throw new Error('unreachable');
    expect(resumed[0].outcome).toMatchObject({ outcome: 'rendered' });

    // No orphaned registry row: it reached ORIGINAL with a real archiveRef.
    const recoveredRow = deps2.registryStore.getByDocId(docId);
    expect(recoveredRow?.state).toBe('ORIGINAL');
    expect(typeof recoveredRow?.archiveRef).toBe('string');

    // No orphaned artifact bytes: exactly one file, and it's the one the
    // registry row now points at.
    const filesAfterResume = listArchivedArtifactFiles(archiveDir);
    expect(filesAfterResume).toEqual([recoveredRow?.archiveRef]);

    // Outbox row cleared — nothing left to resume.
    expect(deps2.registryStore.getOutboxEntry(docId)).toBeUndefined();

    // Resuming again is a no-op: no double-render, no duplicate archive file.
    const resumedAgain = await output2.resumeStrandedCompositions();
    expect(resumedAgain).toEqual([]);
    expect(listArchivedArtifactFiles(archiveDir)).toEqual([recoveredRow?.archiveRef]);

    deps2.deliveryQueue.close();
    deps2.registryStore.close();
  }, 30_000);

  it('a crash AFTER archive-complete but BEFORE the outbox row was cleared never re-archives (no orphaned second copy)', async () => {
    const dbPath = join(tempDir('rollback2-db-'), 'registry.db');
    const archiveDir = tempDir('rollback2-archive-');
    const outboxDir = tempDir('rollback2-outbox-');

    const deps1 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    const businessEvent = sampleBusinessEventKey({ businessObjectId: 'CO-CRASH-0002' });
    const data = validPurchaseOrder();
    const ctx: DeterminationContext = {
      documentType: 'purchase-order',
      businessObject: businessEvent.businessObject,
      event: businessEvent.event,
    };
    const determination = determine(ctx, deps1.documentTypes.rules(), deps1.documentTypes.templateMetas());
    if (determination.outcome !== 'matched') throw new Error('unreachable');
    const [resolution] = determination.resolutions;

    const { row } = deps1.registryStore.mintWithOutbox({ ...businessEvent, ruleId: resolution.ruleId }, resolution, data);
    const docId = row.docId;

    // Composition runs to completion (archive write succeeds) — but the
    // "process" crashes right here, before clearOutboxEntry runs. The
    // outbox row is deliberately left in place to simulate that.
    const outcome = await composeRenderArchiveAndEnqueue(deps1.composition, docId, resolution, data);
    expect(outcome).toMatchObject({ outcome: 'rendered' });
    expect(deps1.registryStore.getOutboxEntry(docId)).toBeDefined(); // still pending — the "interrupted" step

    const filesBeforeResume = listArchivedArtifactFiles(archiveDir);
    expect(filesBeforeResume.length).toBe(1);

    deps1.deliveryQueue.close();
    deps1.registryStore.close();

    const deps2 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    const output2 = buildOutput(deps2);

    const resumed = await output2.resumeStrandedCompositions();
    expect(resumed).toEqual([{ docId, skipped: true }]);

    // Still exactly one archived file — resume recognized the archive was
    // already done and did not render/archive a second copy.
    expect(listArchivedArtifactFiles(archiveDir)).toEqual(filesBeforeResume);
    expect(deps2.registryStore.getOutboxEntry(docId)).toBeUndefined();

    deps2.deliveryQueue.close();
    deps2.registryStore.close();
  }, 30_000);
});
