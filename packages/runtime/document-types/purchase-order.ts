/**
 * Built-in `purchase-order` document type. The `DocNode` tree is the one
 * ROADMAP Stage 3 "Single-process serve" wired for `TemplateMeta.id
 * "po-global-v1"` (packages/runtime/rules/templates/purchase-order-global.
 * json), moved here VERBATIM from the deleted `src/render/template-content.
 * ts` (GAP-08) — proven content, gated by test/corpus/purchase-order; do
 * not "improve" or re-derive it. `po-companyCode-1000-v1` (the
 * companyCode-1000 variant meta) registers META-ONLY, as it always was:
 * a determination candidate whose composition is the honest
 * `no-template-content` outcome, exactly as before the move.
 */
import type { DocNode } from '@busy-office/output-schema';
import type { DocumentTypeDefinition } from '../src/registration/document-type-definition.js';
import { readContract, rulesFor, templatesFor } from './load-sources.js';

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

export const purchaseOrder: DocumentTypeDefinition = {
  documentType: 'purchase-order',
  contract: readContract('purchase-order.schema.json'),
  // Every meta on disk is registered (determination resolves against all
  // of them); `po-companyCode-1000-v1` is meta-only — see header comment.
  templates: templatesFor('purchase-order', { 'po-global-v1': purchaseOrderTemplate }),
  rules: rulesFor('purchase-order'),
  // GAP-10: the email rule needs a governed subject/body. One wildcard-
  // locale template; generic wording, no legal copy — see
  // document-types/payslip.ts for the locale-varying case.
  messageTemplates: [
    {
      meta: { id: 'po-email-global-v1', variant: { documentType: 'purchase-order' }, version: '1.0.0', lifecycle: 'published', provenance: 'human' },
      channel: 'email',
      subject: ['Purchase order ', { expr: 'header.poNumber' }],
      body: ['Purchase order ', { expr: 'header.poNumber' }, ' is attached.\n\nThis message was generated automatically.\n'],
    },
  ],
};
