/**
 * DoD test for ROADMAP Stage 4's "PDF attachment concatenation" task:
 * "merged artifact archived as one document, page counts asserted".
 *
 * Renders a real purchase-order (reusing the same fixture data + template
 * every other test in this package uses — fixtures.ts, render/
 * template-content.ts's `po-global-v1`), merges it with a generated cover
 * sheet and the static test/fixtures/terms-and-conditions.pdf fixture into
 * ONE PDF via `composeConcatenatedRenderArchiveAndEnqueue`, archives it as
 * ONE document through the real `FsArchiveStore` + `SqliteRegistryStore`
 * (same backends `serve()` uses — see e2e.test.ts for the established
 * pattern this test follows), and asserts:
 *   1. exactly one registry row / one archiveRef exists for the merge
 *      (never three separate artifacts),
 *   2. the merged artifact's page count equals cover(1) + main(N) + T&C(M),
 *      using the same `countPdfPages` utility the rest of the corpus uses
 *      (no reimplementing page counting),
 *   3. the merged artifact is still veraPDF-clean PDF/A-2b — merging must
 *      not break the PDF/A conformance the rest of the corpus already
 *      guarantees (docs/STANDARDS.md Tier 2).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countPdfPages, TypstRenderer, verifyPdfA } from '@busy-office/render-typst';
import { createRuntimeDeps, type RuntimeDeps } from './index.js';
import { composeConcatenatedRenderArchiveAndEnqueue } from './composition.js';
import { renderCoverSheet } from './render/cover-sheet.js';
import type { Resolution } from './determination/determine.js';
import { sampleBusinessEventKey, validPurchaseOrder } from './fixtures.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const termsAndConditionsPath = join(here, '..', '..', '..', 'test', 'fixtures', 'terms-and-conditions.pdf');

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('PDF attachment concatenation (ROADMAP Stage 4)', () => {
  let deps: RuntimeDeps;

  beforeEach(() => {
    const dbDir = tempDir('concat-registry-');
    deps = createRuntimeDeps(join(dbDir, 'registry.db'), tempDir('concat-archive-'), tempDir('concat-outbox-'));
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

  it(
    'merges cover sheet + purchase order + T&C fixture into one archived document; page counts and PDF/A-2b hold',
    async () => {
      const termsAndConditionsBytes = new Uint8Array(readFileSync(termsAndConditionsPath));
      const termsAndConditionsPageCount = countPdfPages(termsAndConditionsBytes);
      expect(termsAndConditionsPageCount).toBeGreaterThanOrEqual(2); // fixture is a checked-in 2-page placeholder

      const data = validPurchaseOrder();
      const eventKey = sampleBusinessEventKey({ businessObjectId: '4500055555' });
      const { row: mintedRow } = deps.registryStore.getOrCreateByEventKey(eventKey, 'purchase-order');
      const docId = mintedRow.docId;

      const resolution: Resolution = {
        ruleId: 'test-concat-rule',
        templateId: 'po-global-v1',
        templateVersion: '1.0.0',
        channel: 'email',
        recipients: ['buyer@example.com'],
      };

      // Independently render the main document and cover sheet (same
      // renderer, same TypstRenderer default the runtime wires) to know
      // their true page counts ahead of time, so the merged-page-count
      // assertion below isn't just re-deriving the same arithmetic the
      // function under test performs.
      const standaloneMain = await new TypstRenderer().render({
        kind: 'ir',
        ir: { irVersion: '1', root: (await import('./render/template-content.js')).getTemplateContent('po-global-v1')!, data },
      });
      const mainPageCount = countPdfPages(standaloneMain.bytes);
      const coverBytes = await renderCoverSheet(new TypstRenderer(), docId);
      const coverPageCount = countPdfPages(coverBytes);
      expect(coverPageCount).toBe(1);

      const outcome = await composeConcatenatedRenderArchiveAndEnqueue(
        deps.composition,
        docId,
        resolution,
        data,
        termsAndConditionsBytes,
      );

      if (outcome.outcome === 'render-failed') {
        throw new Error(`render-failed: ${outcome.error}`);
      }
      expect(outcome.outcome).toBe('rendered');
      if (outcome.outcome !== 'rendered') throw new Error('unreachable');

      // Archived as ONE document: one registry row, one archiveRef.
      const row = deps.registryStore.getByDocId(docId);
      expect(row).toBeDefined();
      expect(row?.state).toBe('ORIGINAL');
      expect(row?.archiveRef).toBe(outcome.archiveRef);
      // GAP-15: the concatenation path persists the renderer identity too —
      // the merge is a page-level concatenation, not a second renderer.
      const renderer = deps.composition.renderer;
      expect(row?.rendererVersion).toBe(`${renderer.id}@${renderer.version}`);

      const mergedBytes = await deps.archiveStore.retrieve(outcome.archiveRef);
      expect(Buffer.from(mergedBytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');

      // Page-count assertion — the DoD's literal wording.
      const expectedPageCount = coverPageCount + mainPageCount + termsAndConditionsPageCount;
      expect(countPdfPages(mergedBytes)).toBe(expectedPageCount);

      // Merging must not break PDF/A-2b conformance.
      const pdfa = await verifyPdfA(mergedBytes, '2b');
      if (!pdfa.compliant) {
        const findings = pdfa.failures
          .map((f) => `  - [${f.ruleId ?? '?'}] ${f.description ?? ''}: ${f.errorMessage ?? ''}`)
          .join('\n');
        expect.fail(`merged artifact failed PDF/A-2b validation:\n${findings}`);
      }
      expect(pdfa.compliant).toBe(true);

      // Delivery was enqueued exactly once for the merged artifact.
      const job = deps.deliveryQueue.getJob(outcome.deliveryJobId);
      expect(job?.status).toBe('pending');
    },
    60_000,
  );
});
