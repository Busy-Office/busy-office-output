import { describe, expect, it } from 'vitest';
import type { DocNode, LayoutIR } from '@busy-office/output-schema';
import { diffPdfBytes, formatStructuralDiff, TypstRenderer } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { purchaseOrderTemplate } from './template.js';

/**
 * ROADMAP Stage 2 DoD: "intentional template change produces a readable
 * diff in CI output" — this test IS that proof, run against the real
 * corpus purchase-order case (001-single-page), not a synthetic fixture.
 * Two mutations are exercised, matching the task's own examples:
 *  1. the totals label changed ("Net total" -> "Net Total (excl. tax)")
 *  2. an extra fieldGrid row inserted into the header
 */
const renderer = new TypstRenderer();
const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);

function toIr(root: DocNode): LayoutIR {
  return { irVersion: '1.0.0', root, data };
}

async function renderTemplate(root: DocNode): Promise<Uint8Array> {
  const artifact = await renderer.render({ kind: 'ir', ir: toIr(root) });
  return artifact.bytes;
}

function withChangedTotalsLabel(): DocNode {
  const clone: DocNode = structuredClone(purchaseOrderTemplate);
  const totalsNode = clone.kind === 'document' ? clone.children.find((c) => c.kind === 'totals') : undefined;
  if (!totalsNode || totalsNode.kind !== 'totals') throw new Error('fixture broken: no totals node found');
  const netRow = totalsNode.rows.find((r) => r.label === 'Net total');
  if (!netRow) throw new Error('fixture broken: no "Net total" row found');
  netRow.label = 'Net Total (excl. tax)';
  return clone;
}

function withExtraFieldGridRow(): DocNode {
  const clone: DocNode = structuredClone(purchaseOrderTemplate);
  const header = clone.kind === 'document' ? clone.children.find((c) => c.kind === 'header') : undefined;
  if (!header || header.kind !== 'header') throw new Error('fixture broken: no header node found');
  const fieldGrid = header.children.find((c) => c.kind === 'fieldGrid');
  if (!fieldGrid || fieldGrid.kind !== 'fieldGrid') throw new Error('fixture broken: no fieldGrid node found');
  fieldGrid.fields.push({ label: 'Payment terms', value: 'header.currency' });
  return clone;
}

describe('corpus 008-structural-diff (Task A DoD)', () => {
  it('reports a readable diff for a changed totals label', async () => {
    const baseline = await renderTemplate(purchaseOrderTemplate);
    const changed = await renderTemplate(withChangedTotalsLabel());

    const diff = await diffPdfBytes(baseline, changed);
    const report = formatStructuralDiff(diff);

    expect(diff.identical).toBe(false);
    expect(diff.pageCountDelta).toBe(0);
    // Readable about the SPECIFIC change: the old label's distinguishing
    // word disappears, the new label's distinguishing words appear.
    expect(report).toContain('- "total"');
    expect(report).toContain('+ "Total"');
    expect(report).toContain('+ "(excl.');
    expect(report).toContain('tax)"');
  }, 30000);

  it('reports a readable diff for an inserted fieldGrid row', async () => {
    const baseline = await renderTemplate(purchaseOrderTemplate);
    const changed = await renderTemplate(withExtraFieldGridRow());

    const diff = await diffPdfBytes(baseline, changed);
    const report = formatStructuralDiff(diff);

    expect(diff.identical).toBe(false);
    expect(report).toContain('+ "Payment');
    expect(report).toContain('+ "terms:"');
  }, 30000);
});
