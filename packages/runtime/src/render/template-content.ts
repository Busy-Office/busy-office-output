/**
 * Hardcoded template-content lookup (ROADMAP Stage 3 "Single-process serve"
 * task; scope fixed by an arb-chair ruling — see that task's report in
 * docs/SESSION-LOG.md for the exact wording). Originally exactly ONE entry
 * (purchase-order); ROADMAP Stage 4 "Invoice: tax/multi-currency contract +
 * template" added the second: the `DocNode` tree for `TemplateMeta.id
 * "invoice-global-v1"` (packages/runtime/rules/templates/invoice-global.json)
 * — reused VERBATIM from `test/corpus/invoice/template.ts`, itself copied
 * from Stage 1's paper test (`packages/schema/src/document/paper-test.test.ts`'s
 * `invoiceTemplate`). Do not "improve" or re-derive either tree here — they
 * are proven content; their corpora already gate them.
 *
 * This is explicitly NOT a general template-content registry/loader.
 * Payslip (`payslip-global-v1`) resolves fine through determination (its
 * TemplateMeta row exists in packages/runtime/rules/templates/) but has NO
 * entry here on purpose — `composition.ts`'s
 * `composeRenderArchiveAndEnqueue` treats a missing lookup as an honest,
 * non-crashing `'no-template-content'` outcome, never a 500 and never
 * invented content.
 */
import type { DocNode } from '@busy-office/output-schema';

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

const TEMPLATE_CONTENT: Readonly<Record<string, DocNode>> = {
  'po-global-v1': purchaseOrderTemplate,
  'invoice-global-v1': invoiceTemplate,
};

/** Returns the hardcoded `DocNode` tree for `templateId`, or `undefined` if
 * this templateId has no content wired up yet (honest, not a crash). */
export function getTemplateContent(templateId: string): DocNode | undefined {
  return TEMPLATE_CONTENT[templateId];
}
