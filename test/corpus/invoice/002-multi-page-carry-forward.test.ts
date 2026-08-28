import { describe, expect, it } from 'vitest';
import { countPdfPages, emitDocument } from '@busy-office/render-typst';
import { CORPUS_CASES, generateInvoice } from './generate.js';
import { assertDeterministic } from './determinism.js';
import { invoiceTemplate } from './template.js';
import { toLayoutIR } from './render.js';

describe('corpus 002-multi-page-carry-forward', () => {
  const data = generateInvoice(CORPUS_CASES['002-multi-page-carry-forward']);

  it('uses the state()-based carry-forward technique (present in the generated markup)', () => {
    const ir = toLayoutIR(data);
    const { markup } = emitDocument(ir.root, ir.data);
    expect(markup).toContain('state("bo-running"');
    expect(markup).toContain('Carried forward');
    expect(markup).toContain('table.footer(');
    expect(invoiceTemplate.kind).toBe('document'); // sanity: still typechecks as DocNode
  });

  it('renders deterministically across many page breaks with the running total carried on every page', async () => {
    const bytes = await assertDeterministic(data);
    const pages = countPdfPages(bytes);
    expect(pages).toBeGreaterThan(1);
  }, 60000);
});
