/**
 * DoD test for GAP-31 (docs/GAP-REGISTER.md): inputHash/outputHash are
 * computed and persisted on the registry row at archive time, and stay
 * null on a failed composition.
 *
 * Reuses the same real-backend harness concatenation.test.ts established
 * (`createRuntimeDeps` — real `SqliteRegistryStore` + `FsArchiveStore` +
 * `TypstRenderer`, same as `serve()`), and the same
 * `render-failed`-via-unregistered-renderer-id pattern `selectRenderer`'s
 * own header comment documents (composition.ts): a resolution naming an
 * unknown renderer id throws inside the composition try/catch, before
 * `archiveArtifact` is ever called, so the row is left exactly as minted —
 * DRAFT, no archiveRef, and (per this task) no inputHash/outputHash.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeDeps, type RuntimeDeps } from './index.js';
import { composeRenderArchiveAndEnqueue } from './composition.js';
import type { Resolution } from './determination/determine.js';
import { sampleBusinessEventKey, validPurchaseOrder } from './fixtures.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('inputHash/outputHash (GAP-31)', () => {
  let deps: RuntimeDeps;

  beforeEach(() => {
    const dbDir = tempDir('hash-registry-');
    deps = createRuntimeDeps(join(dbDir, 'registry.db'), tempDir('hash-archive-'), tempDir('hash-outbox-'));
  });

  afterEach(() => {
    deps.deliveryQueue.close();
    deps.registryStore.close();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('a composed document carries inputHash = SHA-256(payload) and outputHash = SHA-256(archived bytes)', async () => {
    const data = validPurchaseOrder();
    const eventKey = sampleBusinessEventKey({ businessObjectId: 'PO-HASH-0001' });
    const { row: mintedRow } = deps.registryStore.getOrCreateByEventKey(eventKey, 'purchase-order');
    const docId = mintedRow.docId;

    const resolution: Resolution = {
      ruleId: 'test-hash-rule',
      templateId: 'po-global-v1',
      templateVersion: '1.0.0',
      channel: 'email',
      recipients: ['buyer@example.com'],
    };

    const outcome = await composeRenderArchiveAndEnqueue(deps.composition, docId, resolution, data);
    if (outcome.outcome === 'render-failed') {
      throw new Error(`render-failed: ${outcome.error}`);
    }
    expect(outcome.outcome).toBe('rendered');
    if (outcome.outcome !== 'rendered') throw new Error('unreachable');

    const row = deps.registryStore.getByDocId(docId);
    expect(row).toBeDefined();
    expect(row?.state).toBe('ORIGINAL');

    // Independently recompute both hashes with Node crypto directly, over
    // the known input payload and the actual archived bytes — not just
    // asserting non-null.
    const expectedInputHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    expect(row?.inputHash).toBe(expectedInputHash);

    const archivedBytes = await deps.archiveStore.retrieve(outcome.archiveRef);
    const expectedOutputHash = createHash('sha256').update(archivedBytes).digest('hex');
    expect(row?.outputHash).toBe(expectedOutputHash);

    // Sanity: a real artifact was archived, so the two hashes differ.
    expect(row?.inputHash).not.toBe(row?.outputHash);
  });

  it('a failed composition leaves both inputHash and outputHash null, exactly like archiveRef', async () => {
    const data = validPurchaseOrder();
    const eventKey = sampleBusinessEventKey({ businessObjectId: 'PO-HASH-0002' });
    const { row: mintedRow } = deps.registryStore.getOrCreateByEventKey(eventKey, 'purchase-order');
    const docId = mintedRow.docId;

    // A resolution declaring a renderer id nothing registers: selectRenderer
    // throws inside composeRenderArchiveAndEnqueue's own try/catch, so this
    // surfaces as 'render-failed' before archiveArtifact (and therefore
    // before any hash is computed or written) ever runs.
    const resolution: Resolution = {
      ruleId: 'test-hash-failure-rule',
      templateId: 'po-global-v1',
      templateVersion: '1.0.0',
      channel: 'email',
      recipients: ['buyer@example.com'],
      renderer: 'no-such-renderer',
    };

    const outcome = await composeRenderArchiveAndEnqueue(deps.composition, docId, resolution, data);
    expect(outcome.outcome).toBe('render-failed');

    const row = deps.registryStore.getByDocId(docId);
    expect(row).toBeDefined();
    expect(row?.state).toBe('DRAFT');
    expect(row?.archiveRef).toBeNull();
    expect(row?.inputHash).toBeNull();
    expect(row?.outputHash).toBeNull();
  });
});
