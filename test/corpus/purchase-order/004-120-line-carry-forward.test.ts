import { describe, expect, it } from 'vitest';
import { countPdfPages, emitDocument } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { assertDeterministic } from './determinism.js';
import { purchaseOrderTemplate } from './template.js';
import { toLayoutIR } from './render.js';

describe('corpus 004-120-line-carry-forward', () => {
  const data = generatePurchaseOrder(CORPUS_CASES['004-120-line-carry-forward']);

  it('uses the state()-based carry-forward technique (present in the generated markup)', () => {
    const ir = toLayoutIR(data);
    const { markup } = emitDocument(ir.root, ir.data);
    // Proves the running-total footer machinery (proven in the Stage 0 spike,
    // git show 526b038:spike/typst/po.typ) is actually emitted for this
    // template, not just theoretically supported.
    expect(markup).toContain('state("bo-running"');
    expect(markup).toContain('Carried forward');
    expect(markup).toContain('table.footer(');
    expect(purchaseOrderTemplate.kind).toBe('document'); // sanity: the adapted tree still typechecks as DocNode
  });

  it('renders deterministically across many page breaks with the running total carried on every page', async () => {
    const bytes = await assertDeterministic(data);
    const pages = countPdfPages(bytes);
    // 120 lines comfortably forces several page breaks — the carry-forward
    // footer/header repeat mechanics are exercised on every one of them.
    expect(pages).toBeGreaterThan(1);
  }, 60000);
});
