import { describe, expect, it } from 'vitest';
import type { DocNode } from '../document/nodes.js';
import type { TemplateMeta } from '../document/template.js';
import { mergeTemplateContent } from './merge.js';
import { resolveParentChain, resolveTemplate } from './resolve.js';

/** Mirrors test/corpus/purchase-order/template.ts's shape: document ->
 * [header{text,fieldGrid}, section{table}, totals, footer{pageNumber}]. */
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
      kind: 'section',
      children: [
        {
          kind: 'table',
          bind: 'lines',
          repeatHeader: true,
          columns: [
            { key: 'lineNumber', width: 'flex', align: 'r', label: '#' },
            { key: 'description', width: 'flex', align: 'l', label: 'Description' },
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
    {
      kind: 'footer',
      children: [{ kind: 'pageNumber', format: 'Page {page} of {pages}' }],
    },
  ],
};

function fieldGridInHeader(tree: DocNode): { label: string; value: string }[] {
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

function tableColumns(tree: DocNode): { key: string; label: string }[] {
  if (tree.kind !== 'document') throw new Error('expected document root');
  const section = tree.children.find((c) => c.kind === 'section');
  if (section?.kind !== 'section') throw new Error('expected section');
  const table = section.children.find((c) => c.kind === 'table');
  if (table?.kind !== 'table') throw new Error('expected table');
  return table.columns.map((c) => ({ key: c.key, label: c.label }));
}

describe('mergeTemplateContent', () => {
  it('a single-layer chain (no parentId) returns the tree unchanged — no regression for existing non-inheriting templates', () => {
    const merged = mergeTemplateContent([baseTree]);
    expect(merged).toEqual(baseTree);
  });

  it('a totals-only fragment layer replaces one row in place by label (child wins) — other rows and the rest of the tree pass through unchanged', () => {
    // Same address (label) as the base's "Tax total" row — a country-specific
    // tax computation, same displayed label. Overriding a fieldGrid/totals
    // row's *value* while keeping its label is exactly what label-as-address
    // supports (docs/GAP-REGISTER.md GAP-27 ruling: label IS the identity for
    // these two kinds, so it cannot itself change without becoming a new row —
    // see the table-column case below for label-changing, which has a
    // separate stable `key`).
    const countryOverride: DocNode = {
      kind: 'totals',
      keepTogether: true,
      rows: [{ label: 'Tax total', value: 'totals.taxTotal.gstAdjustedAmount' }],
    };
    // chain is most-specific-first (resolveParentChain's order): [override, base]
    const merged = mergeTemplateContent([countryOverride, baseTree]);

    expect(totalsRows(merged)).toEqual([
      { label: 'Net total', value: 'totals.netTotal.amount' },
      { label: 'Tax total', value: 'totals.taxTotal.gstAdjustedAmount' },
      { label: 'Grand total', value: 'totals.grandTotal.amount' },
    ]);
    // Everything else — header, table, footer — is untouched.
    expect(fieldGridInHeader(merged)).toEqual(fieldGridInHeader(baseTree));
  });

  it('a fieldGrid-only fragment layer replaces one field in place by label — untouched fields pass through', () => {
    const companyOverride: DocNode = {
      kind: 'fieldGrid',
      columns: 2,
      fields: [{ label: 'Buyer', value: 'header.buyer.legalName' }],
    };
    const merged = mergeTemplateContent([companyOverride, baseTree]);

    expect(fieldGridInHeader(merged)).toEqual([
      { label: 'PO date', value: 'header.poDate' },
      { label: 'Currency', value: 'header.currency' },
      { label: 'Buyer', value: 'header.buyer.legalName' },
      { label: 'Vendor', value: 'header.vendor.name' },
    ]);
    expect(totalsRows(merged)).toEqual(totalsRows(baseTree));
  });

  it('a table-only fragment layer merges columns by key — a column can be relabeled (key is the stable address, label is free to change)', () => {
    const override: DocNode = {
      kind: 'table',
      bind: 'lines',
      repeatHeader: true,
      columns: [{ key: 'description', width: 'flex', align: 'l', label: 'Item description (localized)' }],
    };
    const merged = mergeTemplateContent([override, baseTree]);
    expect(tableColumns(merged)).toEqual([
      { key: 'lineNumber', label: '#' },
      { key: 'description', label: 'Item description (localized)' },
    ]);
  });

  it('folds a three-layer chain most-specific-to-root, applying each override in order', () => {
    const customerOverride: DocNode = { kind: 'totals', keepTogether: true, rows: [{ label: 'Grand total', value: 'totals.grandTotal.net30Amount' }] };
    const countryOverride: DocNode = { kind: 'totals', keepTogether: true, rows: [{ label: 'Tax total', value: 'totals.taxTotal.gstAdjustedAmount' }] };
    // most-specific first: [customer, country, base]
    const merged = mergeTemplateContent([customerOverride, countryOverride, baseTree]);
    expect(totalsRows(merged)).toEqual([
      { label: 'Net total', value: 'totals.netTotal.amount' },
      { label: 'Tax total', value: 'totals.taxTotal.gstAdjustedAmount' },
      { label: 'Grand total', value: 'totals.grandTotal.net30Amount' },
    ]);
  });

  it('a whole-subtree (non-mergeable-kind) layer fully replaces everything merged so far — no partial splice', () => {
    const replacementFooter: DocNode = { kind: 'footer', children: [{ kind: 'pageNumber', format: '{page}/{pages}' }] };
    const merged = mergeTemplateContent([replacementFooter, baseTree]);
    // The whole-subtree rule means the ENTIRE merged tree so far is
    // replaced by the footer layer itself — proving "no partial splice"
    // for container kinds, exactly as the GAP-27 ruling states.
    expect(merged).toEqual(replacementFooter);
  });

  it('throws — never silently no-ops — when a fieldGrid/table/totals layer matches zero nodes of that kind', () => {
    const noFieldGridTree: DocNode = { kind: 'document', page: { size: 'A4', margin: [0, 0, 0, 0] }, children: [] };
    const override: DocNode = { kind: 'fieldGrid', columns: 1, fields: [{ label: 'x', value: 'y' }] };
    expect(() => mergeTemplateContent([override, noFieldGridTree])).toThrow(/found 0/);
  });

  it('throws when a layer would match more than one node of its kind — never guesses', () => {
    const twoTotalsTree: DocNode = {
      kind: 'document',
      page: { size: 'A4', margin: [0, 0, 0, 0] },
      children: [
        { kind: 'totals', keepTogether: true, rows: [{ label: 'a', value: 'a' }] },
        { kind: 'totals', keepTogether: true, rows: [{ label: 'b', value: 'b' }] },
      ],
    };
    const override: DocNode = { kind: 'totals', keepTogether: true, rows: [{ label: 'a', value: 'a2' }] };
    expect(() => mergeTemplateContent([override, twoTotalsTree])).toThrow(/found 2/);
  });

  it('throws on an empty chain', () => {
    expect(() => mergeTemplateContent([])).toThrow(/non-empty chain/);
  });
});

describe('resolveTemplate + resolveParentChain + mergeTemplateContent composed (GAP-27 closure evidence)', () => {
  function meta(id: string, variant: TemplateMeta['variant'], parentId?: string): TemplateMeta {
    return { id, variant, version: '1.0.0', parentId, lifecycle: 'published', renderer: 'typst' };
  }

  const baseMeta = meta('po-global-v1', { documentType: 'purchase-order' });
  const countryMeta = meta('po-country-SG-v1', { documentType: 'purchase-order', country: 'SG' }, 'po-global-v1');
  const companyMeta = meta('po-company-1000-v1', { documentType: 'purchase-order', companyCode: '1000' }, 'po-global-v1');
  const customerMeta = meta('po-customer-vendorX-v1', { documentType: 'purchase-order', partnerId: 'vendor-X' }, 'po-global-v1');

  const byId = new Map<string, TemplateMeta>([
    [baseMeta.id, baseMeta],
    [countryMeta.id, countryMeta],
    [companyMeta.id, companyMeta],
    [customerMeta.id, customerMeta],
  ]);

  const contentById = new Map<string, DocNode>([
    [baseMeta.id, baseTree],
    [countryMeta.id, { kind: 'totals', keepTogether: true, rows: [{ label: 'Tax total', value: 'totals.taxTotal.gstAdjustedAmount' }] }],
    [companyMeta.id, { kind: 'fieldGrid', columns: 2, fields: [{ label: 'Buyer', value: 'header.buyer.legalName' }] }],
    [customerMeta.id, { kind: 'totals', keepTogether: true, rows: [{ label: 'Grand total', value: 'totals.grandTotal.net30Amount' }] }],
  ]);

  it('the country variant resolves over the base by specificity, then its content merges over the parent chain', () => {
    const resolved = resolveTemplate([baseMeta, countryMeta], { documentType: 'purchase-order', country: 'SG' });
    expect(resolved?.id).toBe('po-country-SG-v1');

    const chain = resolveParentChain(resolved!.id, byId);
    expect(chain.map((m) => m.id)).toEqual(['po-country-SG-v1', 'po-global-v1']);

    const merged = mergeTemplateContent(chain.map((m) => contentById.get(m.id)!));
    expect(totalsRows(merged)).toEqual([
      { label: 'Net total', value: 'totals.netTotal.amount' },
      { label: 'Tax total', value: 'totals.taxTotal.gstAdjustedAmount' },
      { label: 'Grand total', value: 'totals.grandTotal.amount' },
    ]);
    // Everything not overridden by the country variant is identical to base.
    expect(fieldGridInHeader(merged)).toEqual(fieldGridInHeader(baseTree));
  });

  it('the company variant wins over the base when companyCode is queried, and merges its fieldGrid override', () => {
    const resolved = resolveTemplate([baseMeta, companyMeta], { documentType: 'purchase-order', companyCode: '1000' });
    expect(resolved?.id).toBe('po-company-1000-v1');
    const chain = resolveParentChain(resolved!.id, byId);
    const merged = mergeTemplateContent(chain.map((m) => contentById.get(m.id)!));
    expect(fieldGridInHeader(merged)).toEqual([
      { label: 'PO date', value: 'header.poDate' },
      { label: 'Currency', value: 'header.currency' },
      { label: 'Buyer', value: 'header.buyer.legalName' },
      { label: 'Vendor', value: 'header.vendor.name' },
    ]);
    expect(totalsRows(merged)).toEqual(totalsRows(baseTree));
  });

  it('the customer (partnerId) variant wins when partnerId is queried, and merges its totals override', () => {
    const resolved = resolveTemplate([baseMeta, customerMeta], { documentType: 'purchase-order', partnerId: 'vendor-X' });
    expect(resolved?.id).toBe('po-customer-vendorX-v1');
    const chain = resolveParentChain(resolved!.id, byId);
    const merged = mergeTemplateContent(chain.map((m) => contentById.get(m.id)!));
    expect(totalsRows(merged)).toEqual([
      { label: 'Net total', value: 'totals.netTotal.amount' },
      { label: 'Tax total', value: 'totals.taxTotal.amount' },
      { label: 'Grand total', value: 'totals.grandTotal.net30Amount' },
    ]);
  });

  it('with no query field matching any variant, the base wins and merges to itself (single layer)', () => {
    const resolved = resolveTemplate([baseMeta, countryMeta, companyMeta, customerMeta], { documentType: 'purchase-order' });
    expect(resolved?.id).toBe('po-global-v1');
    const chain = resolveParentChain(resolved!.id, byId);
    expect(chain).toHaveLength(1);
    const merged = mergeTemplateContent(chain.map((m) => contentById.get(m.id)!));
    expect(merged).toEqual(baseTree);
  });
});
