/**
 * The invoice DocNode tree — copied VERBATIM from the Stage 1 paper test
 * (packages/schema/src/document/paper-test.test.ts's `invoiceTemplate`).
 * Unlike purchase-order's corpus template (which had to ADD `carryForward`
 * to the frozen paper-test tree), the paper-test invoice tree already
 * carries `carryForward: 'netAmount.amount'` on its table — so no
 * adaptation is needed here, only reuse. No node kind or expression
 * outside the frozen nine/the grammar is introduced (ROADMAP Stage 4 task
 * constraint: don't touch packages/schema/src/document/nodes.ts or
 * docs/EXPRESSION-GRAMMAR.md).
 */
import type { DocNode } from '@busy-office/output-schema';

export const invoiceTemplate: DocNode = {
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
