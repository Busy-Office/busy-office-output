/**
 * The DocNode trees the pdf-direct corpus renders — the payslip and
 * purchase-order shapes from test/corpus/payslip/template.ts and
 * test/corpus/purchase-order/template.ts with exactly ONE change each:
 * no `carryForward` on the line table. That is the routing rule ADR-002's
 * task decided (bounded by ADR-001): pdf-direct serves single-page,
 * Latin-only, NO-carry-forward documents; a carry-forward table is
 * refused by the renderer (004-rejects-carry-forward proves it), so a
 * pdf-direct template simply does not declare one. Every other node is
 * identical — same frozen nine kinds, same expressions.
 *
 * `payslipPdfDirectTemplate` is the tree wired VERBATIM into
 * packages/runtime/document-types/ (registered via OutputPort) under
 * `payslip-companyCode-1000-v1` (the one real template routed to
 * pdf-direct). Keep the two byte-identical.
 */
import type { DocNode } from '@busy-office/output-schema';

export const payslipPdfDirectTemplate: DocNode = {
  kind: 'document',
  page: { size: 'A4', margin: [40, 40, 40, 40] },
  children: [
    {
      kind: 'header',
      children: [
        { kind: 'text', value: 'header.payslipNumber', style: 'title' },
        {
          kind: 'fieldGrid',
          columns: 2,
          fields: [
            { label: 'Pay period start', value: 'header.payPeriodStart' },
            { label: 'Pay period end', value: 'header.payPeriodEnd' },
            { label: 'Pay date', value: 'header.payDate' },
            { label: 'Currency', value: 'header.currency' },
            { label: 'Employer', value: 'header.employer.name' },
            { label: 'Employee', value: 'header.employeeName' },
            { label: 'Employee ID', value: 'header.employeeId' },
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
            { key: 'code', width: 'flex', align: 'l', label: 'Code' },
            { key: 'description', width: 'flex', align: 'l', label: 'Description' },
            { key: 'type', width: 'flex', align: 'c', label: 'Type' },
            { key: 'amount.amount', width: 'flex', align: 'r', label: 'Amount' },
          ],
        },
      ],
    },
    {
      kind: 'totals',
      keepTogether: true,
      rows: [
        { label: 'Gross pay', value: 'totals.grossPay.amount' },
        { label: 'Total deductions', value: 'totals.totalDeductions.amount' },
        { label: 'Net pay', value: 'totals.netPay.amount' },
      ],
    },
    {
      kind: 'footer',
      children: [{ kind: 'pageNumber', format: 'Page {page} of {pages}' }],
    },
  ],
};

export const purchaseOrderPdfDirectTemplate: DocNode = {
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
