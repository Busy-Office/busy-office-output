/**
 * The purchase-order DocNode tree — copied from the Stage 1 paper test
 * (packages/schema/src/document/paper-test.test.ts's `purchaseOrderTemplate`)
 * and adapted for Stage 2's corpus: the frozen paper-test tree has no
 * `carryForward` on its table (that field is only exercised there by the
 * invoice template), but ROADMAP Stage 2 explicitly requires a
 * `004-120-line-carry-forward` PURCHASE ORDER case. `carryForward:
 * 'netAmount.amount'` is added here, mirroring exactly how the invoice
 * template in the same paper-test file uses it — this is "reuse the tree
 * shape, adapt it", not a new tree design. No node kind or expression
 * outside the frozen nine/the grammar is introduced.
 *
 * Stage 6 addendum: two fieldGrid rows bind the whole Address object
 * (header.buyer.address / header.vendor.address, not a leaf field) — still
 * a plain dot-path per docs/EXPRESSION-GRAMMAR.md, evaluated exactly like
 * any other fieldGrid value. This gives the locale-aware address
 * line-ordering work (packages/render-typst/src/format.ts) something real
 * to render in the SAME template used by every locale case, so the Stage 6
 * exit gate ("the same PO template renders correctly in en-SG, ja-JP,
 * th-TH, ar-SA with zero forking") is exercised across all three
 * locale-formatting dimensions (money, date, address), not just two.
 * 009-template-from-sample-roundtrip.test.ts's independently
 * hand-reconstructed template mirrors this same addition.
 */
import type { DocNode } from '@busy-office/output-schema';

export const purchaseOrderTemplate: DocNode = {
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
            { label: 'Buyer address', value: 'header.buyer.address' },
            { label: 'Vendor address', value: 'header.vendor.address' },
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
          carryForward: 'netAmount.amount',
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
