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
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import { createDocumentTypeRegistry } from '../registration/document-type-registry.js';
import { createTemplateLifecycle } from '../lifecycle/template-lifecycle.js';
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

describe('createOutput: template lifecycle THROUGH emit (Stage 5 task 1) — only `published` is live; preview is unfiltered', () => {
  const memoContract = { type: 'object', properties: { header: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }, required: ['header'] };
  const memoContent = {
    kind: 'document' as const,
    page: { size: 'A4' as const, margin: [40, 40, 40, 40] as [number, number, number, number] },
    children: [{ kind: 'text' as const, value: 'header.title', style: 'title' }],
  };
  function memoDefinition(input: {
    docLifecycles: Record<string, 'draft' | 'review' | 'approved' | 'published' | 'retired'>;
    messageLifecycle: 'draft' | 'review' | 'approved' | 'published' | 'retired';
  }) {
    return {
      documentType: 'memo',
      contract: memoContract,
      templates: [
        // Global (least specific) and companyCode-1000 (more specific) variants.
        ...Object.entries(input.docLifecycles).map(([id, lifecycle]) => ({
          meta: {
            id,
            variant: id.includes('1000') ? { documentType: 'memo', companyCode: '1000' } : { documentType: 'memo' },
            version: '1.0.0',
            lifecycle,
            renderer: 'typst',
          },
          content: memoContent,
        })),
      ],
      rules: [{ id: 'memo-email', conditions: { documentType: 'memo' }, resolution: { channel: 'email', recipients: ['x@example.com'] } }],
      messageTemplates: [
        { meta: { id: 'memo-email-v1', variant: { documentType: 'memo' }, version: '1.0.0', lifecycle: input.messageLifecycle }, channel: 'email' as const, subject: ['Memo'], body: ['Attached.'] },
      ],
    };
  }
  const memoEvent = { businessObject: 'MEMO', businessObjectId: 'M-1', event: 'memo.issued', templateVersion: '1.0.0' };

  it('a draft candidate more specific than a published one loses; the trace lists it with the lifecycle reason', async () => {
    const store = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore: store }); // determination-only port
    expect(port.registerDocumentType(memoDefinition({ docLifecycles: { 'memo-global': 'published', 'memo-1000-draft': 'draft' }, messageLifecycle: 'published' })).status).toBe('registered');

    const result = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent, determination: { companyCode: '1000' } });
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error('unreachable');
    expect(result.resolutions[0].templateId).toBe('memo-global');
    const draftEntry = result.trace.resolutions[0].templates.find((t) => t.templateId === 'memo-1000-draft');
    expect(draftEntry).toMatchObject({ matched: false, reasons: expect.arrayContaining(['lifecycle: draft — only published templates are live candidates']) });
    store.close();
  });

  it.each(['draft', 'review', 'approved', 'retired'] as const)('only-match-is-%s → no-template-match with the reason in the (persisted) trace', async (lifecycle) => {
    const store = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore: store });
    port.registerDocumentType(memoDefinition({ docLifecycles: { 'memo-global': lifecycle }, messageLifecycle: 'published' }));

    const result = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent });
    expect(result.status).toBe('no-template-match');
    if (result.status !== 'no-template-match') throw new Error('unreachable');
    expect(result.trace.resolutions[0].templates[0].reasons).toContain(`lifecycle: ${lifecycle} — only published templates are live candidates`);
    expect(store.listDocuments()).toEqual([]); // nothing minted
    store.close();
  });

  it('message templates are governed too: only-match-is-draft → unresolved-message-template', async () => {
    const store = createSqliteRegistryStore(':memory:');
    const port = createOutput({ registryStore: store });
    port.registerDocumentType(memoDefinition({ docLifecycles: { 'memo-global': 'published' }, messageLifecycle: 'draft' }));

    const result = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent });
    expect(result.status).toBe('unresolved-message-template');
    if (result.status !== 'unresolved-message-template') throw new Error('unreachable');
    expect(result.trace.resolutions[0].messageTemplates?.[0].reasons).toContain('lifecycle: draft — only published templates are live candidates');
    store.close();
  });

  it('the PERSISTED state governs emit, not the declaration: publishing a draft through the log makes it live, retiring makes it dead — and the registry maps never change', async () => {
    const store = createSqliteRegistryStore(':memory:');
    const documentTypes = createDocumentTypeRegistry();
    const port = createOutput({ registryStore: store, documentTypes });
    port.registerDocumentType(memoDefinition({ docLifecycles: { 'memo-global': 'draft' }, messageLifecycle: 'published' }));
    const declared = JSON.stringify(documentTypes.templateMetas());

    expect((await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent })).status).toBe('no-template-match');

    const lifecycle = createTemplateLifecycle(store);
    const key = { templateId: 'memo-global', version: '1.0.0' };
    expect(lifecycle.transition(key, 'review', { role: 'author', subjectId: 'alice' }, 'submit')).toMatchObject({ status: 'transitioned' });
    expect(lifecycle.transition(key, 'approved', { role: 'reviewer', subjectId: 'bob' }, 'ok')).toMatchObject({ status: 'transitioned' });
    expect(lifecycle.transition(key, 'published', { role: 'approver', subjectId: 'carol' }, 'go')).toMatchObject({ status: 'transitioned' });

    const live = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: memoEvent });
    expect(live.status).toBe('accepted');

    expect(lifecycle.transition(key, 'retired', { role: 'approver', subjectId: 'carol' }, 'pulled')).toMatchObject({ status: 'transitioned' });
    const dead = await port.emit({ documentType: 'memo', payload: { header: { title: 'hi' } }, businessEvent: { ...memoEvent, businessObjectId: 'M-2' } });
    expect(dead.status).toBe('no-template-match');

    expect(JSON.stringify(documentTypes.templateMetas())).toBe(declared);
    expect(documentTypes.templateMeta('memo-global')?.lifecycle).toBe('draft');
    store.close();
  });

  it('preview renders a `draft` template unchanged (previewing a draft is the point; it mints nothing)', async () => {
    const dbPath = join(tempDir('lifecycle-preview-db-'), 'registry.db');
    const deps = createRuntimeDeps(dbPath, tempDir('lifecycle-preview-archive-'), tempDir('lifecycle-preview-outbox-'));
    const output = buildOutput(deps);
    expect(output.registerDocumentType(memoDefinition({ docLifecycles: { 'memo-global': 'draft' }, messageLifecycle: 'draft' })).status).toBe('registered');

    const result = await output.preview({ documentType: 'memo', payload: { header: { title: 'Preview of a draft' } }, templateId: 'memo-global' });
    if (result.status !== 'rendered') throw new Error(`preview failed: ${JSON.stringify(result)}`);
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(deps.registryStore.listDocuments()).toEqual([]);

    deps.deliveryQueue.close();
    deps.registryStore.close();
  }, 30_000);
});
