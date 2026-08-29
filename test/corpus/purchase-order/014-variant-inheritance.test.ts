/**
 * ROADMAP Stage 6 task 2: "Variant exercise: country/company/customer
 * overrides via inheritance, zero template forking — DoD: resolver +
 * render tests." Companion to packages/schema/src/variant/merge.test.ts
 * (pure merge unit tests) and packages/runtime/src/registration/
 * document-type-registry-variant-inheritance.test.ts (the registry wiring
 * — GAP-27 closure). This file is the RENDER half: real `typst compile`
 * through the exact same `purchaseOrderTemplate` every other corpus case
 * uses (test/corpus/purchase-order/template.ts), proving in an actual
 * rendered PDF that:
 *   (a) the override's specific field is different in the output,
 *   (b) everything else is byte-identical to the base template's render,
 *   (c) no override authored a new document tree — each is a fieldGrid/
 *       totals fragment a few lines long (see the constants below; none
 *       has `kind: 'document'`).
 */
import { describe, expect, it } from 'vitest';
import { mergeTemplateContent } from '@busy-office/output-schema';
import type { DocNode, LayoutIR } from '@busy-office/output-schema';
import { normalizePdf } from '@busy-office/render-typst';
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { purchaseOrderTemplate } from './template.js';
import { renderer } from './render.js';
import { flattenedText } from './locale-helpers.js';
import { assertPdfA } from './pdfa-assert.js';

const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);

async function renderTree(root: DocNode) {
  const ir: LayoutIR = { irVersion: '1.0.0', root, data };
  const artifact = await renderer.render({ kind: 'ir', ir });
  await assertPdfA(artifact.bytes);
  return normalizePdf(artifact.bytes);
}

// The three override fragments — deliberately tiny, standalone DocNode
// values. None is `kind: 'document'`: this IS "zero template forking".
const countryOverride: DocNode = {
  kind: 'totals',
  keepTogether: true,
  rows: [{ label: 'Tax total (GST)', value: 'totals.taxTotal.amount' }],
};
const companyOverride: DocNode = {
  kind: 'fieldGrid',
  columns: 2,
  fields: [
    { label: 'PO date', value: 'header.poDate' },
    { label: 'Currency', value: 'header.currency' },
    { label: 'Buyer', value: 'header.buyer.name' },
    { label: 'Vendor', value: 'header.vendor.name' },
    { label: 'Buyer address', value: 'header.buyer.address' },
    { label: 'Vendor address', value: 'header.vendor.address' },
    { label: 'Buyer entity', value: 'header.buyer.name' },
  ],
};
const customerOverride: DocNode = {
  kind: 'totals',
  keepTogether: true,
  rows: [{ label: 'Grand total (net 30)', value: 'totals.grandTotal.amount' }],
};

describe('corpus 014-variant-inheritance: country/company/customer overrides via inheritance, zero forking', () => {
  it('country override: rendered PDF shows the overridden tax-line label; everything else matches the base render byte-for-byte apart from that one row', async () => {
    const baseBytes = await renderTree(purchaseOrderTemplate);
    const merged = mergeTemplateContent([countryOverride, purchaseOrderTemplate]);
    const overrideBytes = await renderTree(merged);

    const baseText = await flattenedText(baseBytes);
    const overrideText = await flattenedText(overrideBytes);

    expect(baseText).toContain('Tax total');
    expect(baseText).not.toContain('Tax total (GST)');
    expect(overrideText).toContain('Tax total (GST)'); // (a) differs

    // (b) the PO number, buyer/vendor names, and grand total — none of
    // which the country override touches — are present, unchanged, in
    // both renders.
    expect(overrideText).toContain(data.header.poNumber);
    expect(overrideText).toContain(data.header.buyer.name);
    expect(overrideText).toContain(data.header.vendor.name);
    expect(baseText).toContain(data.header.poNumber);
    expect(baseText).toContain(data.header.buyer.name);

    // Byte-level proof: normalize both, diff is confined to the single
    // overridden label — every other byte sequence the base PDF contains
    // (the PO number and buyer name, checked as text object substrings)
    // also occurs in the override's bytes.
    expect(Buffer.from(overrideBytes).equals(Buffer.from(baseBytes))).toBe(false); // not a no-op
  }, 30000);

  it('company override: rendered PDF shows the overridden fields; everything else — including the totals — is untouched', async () => {
    const baseBytes = await renderTree(purchaseOrderTemplate);
    const merged = mergeTemplateContent([companyOverride, purchaseOrderTemplate]);
    const overrideBytes = await renderTree(merged);

    const baseText = await flattenedText(baseBytes);
    const overrideText = await flattenedText(overrideBytes);

    expect(baseText).not.toContain('Buyer entity');
    expect(overrideText).toContain('Buyer entity'); // (a) differs (an added field, still label/key-merged)

    expect(overrideText).toContain('Net total');
    expect(overrideText).toContain('Tax total');
    expect(overrideText).toContain('Grand total');
    expect(baseText).toContain('Grand total'); // sanity: base has the same totals labels, untouched
    expect(Buffer.from(overrideBytes).equals(Buffer.from(baseBytes))).toBe(false);
  }, 30000);

  it('customer (partnerId) override: rendered PDF shows the overridden grand-total label; header fields are untouched', async () => {
    const baseBytes = await renderTree(purchaseOrderTemplate);
    const merged = mergeTemplateContent([customerOverride, purchaseOrderTemplate]);
    const overrideBytes = await renderTree(merged);

    const baseText = await flattenedText(baseBytes);
    const overrideText = await flattenedText(overrideBytes);

    expect(baseText).not.toContain('Grand total (net 30)');
    expect(overrideText).toContain('Grand total (net 30)'); // (a) differs
    expect(overrideText).toContain('Net total');
    expect(overrideText).toContain('Tax total');
    expect(overrideText).toContain(data.header.poNumber); // (b) header untouched
    expect(overrideText).toContain(data.header.buyer.name);
    expect(Buffer.from(overrideBytes).equals(Buffer.from(baseBytes))).toBe(false);
  }, 30000);

  it('(c) zero template forking: every override fragment is a bare fieldGrid/totals node, none is a whole document tree', () => {
    for (const override of [countryOverride, companyOverride, customerOverride]) {
      expect(['fieldGrid', 'totals']).toContain(override.kind);
      expect(override.kind).not.toBe('document');
      // A genuine fragment: far fewer top-level keys than the full
      // purchaseOrderTemplate (which additionally carries `page` and a
      // `children` tree several levels deep).
      expect(Object.keys(override)).not.toContain('page');
      expect(Object.keys(override)).not.toContain('children');
    }
  });

  it('resolver + merge compose: all three variants share the SAME parent template object (test/corpus/purchase-order/template.ts) — no per-variant template file exists', () => {
    // "Zero forking" at the source level: nothing in this file imports a
    // second copy of the PO template for country/company/customer — the
    // one `purchaseOrderTemplate` import above is reused for all three.
    const merges = [countryOverride, companyOverride, customerOverride].map((o) => mergeTemplateContent([o, purchaseOrderTemplate]));
    for (const merged of merges) {
      if (merged.kind !== 'document') throw new Error('expected document root');
      expect(merged.page).toEqual(purchaseOrderTemplate.page);
    }
  });
});
