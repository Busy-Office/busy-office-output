/**
 * ROADMAP Stage 6 task 2: "Variant exercise: country/company/customer
 * overrides via inheritance, zero template forking." GAP-27 (docs/
 * GAP-REGISTER.md) named exactly this gap — `parentId` content-merge was
 * specified at Stage 1 but never wired into a real lookup path. This test
 * proves it now IS wired: it drives `DocumentTypeRegistry.templateContent`
 * — the exact function `composeRenderArchiveAndEnqueue`
 * (packages/runtime/src/composition.ts) calls for every resolution — not
 * a standalone merge function nobody calls.
 *
 * One base template (`po-global-v1`, a full tree) plus three override
 * variants, each with `parentId: 'po-global-v1'` and a CONTENT FRAGMENT —
 * a bare `fieldGrid` or `totals` node, a handful of lines — never a
 * second copy of the whole document. That smallness IS "zero template
 * forking": grep the override `content` literals below, there is no
 * `kind: 'document'` in any of them.
 */
import { describe, expect, it } from 'vitest';
import type { DocNode } from '@busy-office/output-schema';
import { resolveTemplate } from '@busy-office/output-schema';
import { createDocumentTypeRegistry } from './document-type-registry.js';
import type { DocumentTypeDefinition } from './document-type-definition.js';

const contract = {
  type: 'object',
  properties: { documentType: { const: 'variant-po' }, header: { type: 'object' } },
  required: ['documentType'],
};

const baseTree: DocNode = {
  kind: 'document',
  page: { size: 'A4', margin: [40, 40, 40, 40] },
  children: [
    {
      kind: 'header',
      children: [
        { kind: 'text', value: 'header.poNumber', style: 'title' },
        {
          kind: 'fieldGrid',
          columns: 2,
          fields: [
            { label: 'PO date', value: 'header.poDate' },
            { label: 'Currency', value: 'header.currency' },
            { label: 'Buyer', value: 'header.buyer.name' },
            { label: 'Vendor', value: 'header.vendor.name' },
          ],
        },
      ],
    },
    {
      kind: 'totals',
      keepTogether: true,
      rows: [
        { label: 'Net total', value: 'totals.netTotal.amount' },
        { label: 'Tax total', value: 'totals.taxTotal.amount' },
        { label: 'Grand total', value: 'totals.grandTotal.amount' },
      ],
    },
    { kind: 'footer', children: [{ kind: 'pageNumber', format: 'Page {page} of {pages}' }] },
  ],
};

// The three override fragments — each a tiny, standalone DocNode, never a
// whole-document tree. This is the "zero forking" evidence: count the
// lines, count the node kinds, compare to `baseTree` above.
const countryOverrideContent: DocNode = {
  kind: 'totals',
  keepTogether: true,
  rows: [{ label: 'Tax total', value: 'totals.taxTotal.gstAmount' }],
};
const companyOverrideContent: DocNode = {
  kind: 'fieldGrid',
  columns: 2,
  fields: [{ label: 'Buyer', value: 'header.buyer.legalEntityName' }],
};
const customerOverrideContent: DocNode = {
  kind: 'totals',
  keepTogether: true,
  rows: [{ label: 'Grand total', value: 'totals.grandTotal.net30Amount' }],
};

const definition: DocumentTypeDefinition = {
  documentType: 'variant-po',
  contract,
  rules: [],
  templates: [
    { meta: { id: 'po-global-v1', variant: { documentType: 'variant-po' }, version: '1.0.0', lifecycle: 'published', renderer: 'typst' }, content: baseTree },
    {
      meta: { id: 'po-country-SG-v1', variant: { documentType: 'variant-po', country: 'SG' }, version: '1.0.0', parentId: 'po-global-v1', lifecycle: 'published', renderer: 'typst' },
      content: countryOverrideContent,
    },
    {
      meta: { id: 'po-company-1000-v1', variant: { documentType: 'variant-po', companyCode: '1000' }, version: '1.0.0', parentId: 'po-global-v1', lifecycle: 'published', renderer: 'typst' },
      content: companyOverrideContent,
    },
    {
      meta: {
        id: 'po-customer-vendorX-v1',
        variant: { documentType: 'variant-po', partnerId: 'vendor-X' },
        version: '1.0.0',
        parentId: 'po-global-v1',
        lifecycle: 'published',
        renderer: 'typst',
      },
      content: customerOverrideContent,
    },
  ],
};

function fieldGridFields(tree: DocNode): { label: string; value: string }[] {
  if (tree.kind !== 'document') throw new Error('expected document root');
  const header = tree.children.find((c) => c.kind === 'header');
  if (header?.kind !== 'header') throw new Error('expected header');
  const fieldGrid = header.children.find((c) => c.kind === 'fieldGrid');
  if (fieldGrid?.kind !== 'fieldGrid') throw new Error('expected fieldGrid');
  return fieldGrid.fields;
}

function totalsRows(tree: DocNode): { label: string; value: string }[] {
  if (tree.kind !== 'document') throw new Error('expected document root');
  const totals = tree.children.find((c) => c.kind === 'totals');
  if (totals?.kind !== 'totals') throw new Error('expected totals');
  return totals.rows;
}

describe('DocumentTypeRegistry.templateContent wires parentId content-merge (GAP-27 closure)', () => {
  const registry = createDocumentTypeRegistry();
  const result = registry.register(definition);

  it('registers the base + 3 overrides atomically', () => {
    expect(result).toEqual({
      status: 'registered',
      documentType: 'variant-po',
      templateIds: ['po-global-v1', 'po-country-SG-v1', 'po-company-1000-v1', 'po-customer-vendorX-v1'],
      messageTemplateIds: [],
    });
  });

  it('the base template composes to its own tree unchanged', () => {
    expect(registry.templateContent('po-global-v1')).toEqual(baseTree);
  });

  it('country override: overridden row differs, everything else is byte-identical to base', () => {
    const merged = registry.templateContent('po-country-SG-v1')!;
    expect(totalsRows(merged)).toEqual([
      { label: 'Net total', value: 'totals.netTotal.amount' },
      { label: 'Tax total', value: 'totals.taxTotal.gstAmount' }, // (a) differs
      { label: 'Grand total', value: 'totals.grandTotal.amount' },
    ]);
    expect(fieldGridFields(merged)).toEqual(fieldGridFields(baseTree)); // (b) everything else identical
  });

  it('company override: overridden field differs, everything else is byte-identical to base', () => {
    const merged = registry.templateContent('po-company-1000-v1')!;
    expect(fieldGridFields(merged)).toEqual([
      { label: 'PO date', value: 'header.poDate' },
      { label: 'Currency', value: 'header.currency' },
      { label: 'Buyer', value: 'header.buyer.legalEntityName' }, // (a) differs
      { label: 'Vendor', value: 'header.vendor.name' },
    ]);
    expect(totalsRows(merged)).toEqual(totalsRows(baseTree)); // (b) everything else identical
  });

  it('customer (partnerId) override: overridden row differs, everything else is byte-identical to base', () => {
    const merged = registry.templateContent('po-customer-vendorX-v1')!;
    expect(totalsRows(merged)).toEqual([
      { label: 'Net total', value: 'totals.netTotal.amount' },
      { label: 'Tax total', value: 'totals.taxTotal.amount' },
      { label: 'Grand total', value: 'totals.grandTotal.net30Amount' }, // (a) differs
    ]);
    expect(fieldGridFields(merged)).toEqual(fieldGridFields(baseTree)); // (b) everything else identical
  });

  it('(c) no override authored a whole document tree — every override content literal is a bare fieldGrid/totals fragment', () => {
    for (const content of [countryOverrideContent, companyOverrideContent, customerOverrideContent]) {
      expect(content.kind).not.toBe('document');
      expect(['fieldGrid', 'totals']).toContain(content.kind);
    }
  });

  it('resolveTemplate + templateContent compose: the most-specific variant wins, then its content merges over the chain', () => {
    const metas = registry.templateMetas();
    const resolvedForSG = resolveTemplate(metas, { documentType: 'variant-po', country: 'SG' });
    expect(resolvedForSG?.id).toBe('po-country-SG-v1');
    expect(totalsRows(registry.templateContent(resolvedForSG!.id)!)).toEqual(
      expect.arrayContaining([{ label: 'Tax total', value: 'totals.taxTotal.gstAmount' }]),
    );

    const resolvedForNoMatch = resolveTemplate(metas, { documentType: 'variant-po' });
    expect(resolvedForNoMatch?.id).toBe('po-global-v1');
    expect(registry.templateContent(resolvedForNoMatch!.id)).toEqual(baseTree);
  });
});

describe('parentId registration validation (GAP-27 safety net)', () => {
  it('rejects a template whose parentId is not registered — atomically, with the rest of the definition untouched', () => {
    const registry = createDocumentTypeRegistry();
    const bad: DocumentTypeDefinition = {
      documentType: 'variant-po',
      contract,
      rules: [],
      templates: [
        {
          meta: { id: 'po-orphan-v1', variant: { documentType: 'variant-po', country: 'TH' }, version: '1.0.0', parentId: 'no-such-template', lifecycle: 'published', renderer: 'typst' },
          content: countryOverrideContent,
        },
      ],
    };
    const result = registry.register(bad);
    expect(result.status).toBe('invalid');
    expect(registry.documentTypes()).toEqual([]); // nothing committed
  });

  it('rejects a parentId cycle', () => {
    const registry = createDocumentTypeRegistry();
    const cyclic: DocumentTypeDefinition = {
      documentType: 'variant-po',
      contract,
      rules: [],
      templates: [
        { meta: { id: 'po-a', variant: { documentType: 'variant-po' }, version: '1.0.0', parentId: 'po-b', lifecycle: 'published', renderer: 'typst' }, content: countryOverrideContent },
        { meta: { id: 'po-b', variant: { documentType: 'variant-po' }, version: '1.0.0', parentId: 'po-a', lifecycle: 'published', renderer: 'typst' }, content: companyOverrideContent },
      ],
    };
    const result = registry.register(cyclic);
    expect(result.status).toBe('invalid');
  });
});
