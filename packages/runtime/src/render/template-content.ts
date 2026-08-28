/**
 * Hardcoded template-content lookup (ROADMAP Stage 3 "Single-process serve"
 * task; scope fixed by an arb-chair ruling — see that task's report in
 * docs/SESSION-LOG.md for the exact wording). Exactly ONE entry: the
 * `DocNode` tree for `TemplateMeta.id "po-global-v1"`
 * (packages/runtime/rules/templates/purchase-order-global.json) — the
 * purchase-order tree, reused VERBATIM from
 * `test/corpus/purchase-order/template.ts`, itself copied from Stage 1's
 * paper test (`packages/schema/src/document/paper-test.test.ts`'s
 * `purchaseOrderTemplate`). Do not "improve" or re-derive this tree here —
 * it is proven content; the corpus already gates it.
 *
 * This is explicitly NOT a general template-content registry/loader.
 * Invoice (`invoice-global-v1`) and payslip (`payslip-global-v1`) resolve
 * fine through determination (their TemplateMeta rows exist in
 * packages/runtime/rules/templates/) but have NO entry here on purpose —
 * `composition.ts`'s `composeRenderArchiveAndEnqueue` treats a missing
 * lookup as an honest, non-crashing `'no-template-content'` outcome, never
 * a 500 and never invented content.
 */
import type { DocNode } from '@busy-office/output-schema';

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
};

/** Returns the hardcoded `DocNode` tree for `templateId`, or `undefined` if
 * this templateId has no content wired up yet (honest, not a crash). */
export function getTemplateContent(templateId: string): DocNode | undefined {
  return TEMPLATE_CONTENT[templateId];
}
