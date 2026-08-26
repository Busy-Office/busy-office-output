/**
 * Stage 1 paper test (ROADMAP.md): PO and invoice templates written in the
 * chosen model (Path A `DocNode` trees) using zero node kinds beyond the
 * nine frozen in nodes.ts, and zero expression syntax beyond
 * docs/EXPRESSION-GRAMMAR.md. TypeScript's structural typing on `DocNode`
 * is itself part of the proof: if either tree below needed a tenth kind,
 * this file would fail to typecheck. The runtime assertions additionally
 * confirm every bound expression parses under the grammar.
 */
import { describe, expect, it } from 'vitest';
import type { DocNode } from './nodes.js';
import { parseExpression, parseRelativePath } from '../expression/parse.js';

const purchaseOrderTemplate: DocNode = {
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
      keepTogether: false,
      children: [
        {
          kind: 'table',
          bind: 'lines',
          repeatHeader: true,
          columns: [
            { key: 'lineNumber', width: 'flex', align: 'r', label: '#' },
            { key: 'materialId', width: 'flex', align: 'l', label: 'Material' },
            { key: 'description', width: 'flex', align: 'l', label: 'Description' },
            { key: 'quantity', width: 'flex', align: 'r', label: 'Qty' },
            { key: 'unitOfMeasure', width: 'flex', align: 'c', label: 'UoM' },
            { key: 'unitPrice.amount', width: 'flex', align: 'r', label: 'Unit price' },
            { key: 'netAmount.amount', width: 'flex', align: 'r', label: 'Net' },
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

const invoiceTemplate: DocNode = {
  kind: 'document',
  page: { size: 'A4', margin: [40, 40, 40, 40] },
  children: [
    {
      kind: 'header',
      children: [
        { kind: 'text', value: 'header.invoiceNumber', style: 'title' },
        {
          kind: 'fieldGrid',
          columns: 2,
          fields: [
            { label: 'Invoice date', value: 'header.invoiceDate' },
            { label: 'Due date', value: 'header.dueDate' },
            { label: 'Currency', value: 'header.currency' },
            { label: 'PO reference', value: 'header.poReference' },
            { label: 'Seller', value: 'header.seller.name' },
            { label: 'Buyer', value: 'header.buyer.name' },
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
          carryForward: 'netAmount.amount',
          columns: [
            { key: 'lineNumber', width: 'flex', align: 'r', label: '#' },
            { key: 'description', width: 'flex', align: 'l', label: 'Description' },
            { key: 'quantity', width: 'flex', align: 'r', label: 'Qty' },
            { key: 'unitOfMeasure', width: 'flex', align: 'c', label: 'UoM' },
            { key: 'unitPrice.amount', width: 'flex', align: 'r', label: 'Unit price' },
            { key: 'taxRate', width: 'flex', align: 'r', label: 'Tax %' },
            { key: 'netAmount.amount', width: 'flex', align: 'r', label: 'Net' },
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

/** Walks a DocNode tree, returning every bound expression with its grammar context. */
function collectExpressions(node: DocNode): Array<{ context: 'rooted' | 'relative'; value: string }> {
  const out: Array<{ context: 'rooted' | 'relative'; value: string }> = [];
  switch (node.kind) {
    case 'document':
    case 'section':
    case 'header':
    case 'footer':
      for (const child of node.children) out.push(...collectExpressions(child));
      break;
    case 'text':
      out.push({ context: 'rooted', value: node.value });
      break;
    case 'fieldGrid':
      for (const field of node.fields) out.push({ context: 'rooted', value: field.value });
      break;
    case 'table':
      out.push({ context: 'rooted', value: node.bind });
      for (const column of node.columns) out.push({ context: 'relative', value: column.key });
      if (node.carryForward) out.push({ context: 'relative', value: node.carryForward });
      break;
    case 'totals':
      for (const row of node.rows) out.push({ context: 'rooted', value: row.value });
      break;
    case 'pageNumber':
      break;
  }
  return out;
}

describe('Stage 1 paper test — purchase order', () => {
  it('uses only the nine frozen node kinds (structural — see file header)', () => {
    expect(purchaseOrderTemplate.kind).toBe('document');
  });

  it('every bound expression parses under docs/EXPRESSION-GRAMMAR.md', () => {
    for (const { context, value } of collectExpressions(purchaseOrderTemplate)) {
      expect(() => (context === 'rooted' ? parseExpression(value) : parseRelativePath(value))).not.toThrow();
    }
  });
});

describe('Stage 1 paper test — invoice', () => {
  it('uses only the nine frozen node kinds (structural — see file header)', () => {
    expect(invoiceTemplate.kind).toBe('document');
  });

  it('every bound expression parses under docs/EXPRESSION-GRAMMAR.md', () => {
    for (const { context, value } of collectExpressions(invoiceTemplate)) {
      expect(() => (context === 'rooted' ? parseExpression(value) : parseRelativePath(value))).not.toThrow();
    }
  });
});
