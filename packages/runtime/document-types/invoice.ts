/**
 * Built-in `invoice` document type. The `DocNode` tree is the one ROADMAP
 * Stage 4 "Invoice: tax/multi-currency contract + template" wired for
 * `TemplateMeta.id "invoice-global-v1"` (packages/runtime/rules/templates/
 * invoice-global.json) — reused VERBATIM from `test/corpus/invoice/
 * template.ts` (itself Stage 1's paper-test `invoiceTemplate`), moved here
 * unchanged from the deleted `src/render/template-content.ts` (GAP-08).
 * Proven content, gated by its corpus; do not "improve" or re-derive it.
 */
import type { DocNode } from '@busy-office/output-schema';
import type { DocumentTypeDefinition } from '../src/registration/document-type-definition.js';
import { readContract, rulesFor, templatesFor } from './load-sources.js';

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

export const invoice: DocumentTypeDefinition = {
  documentType: 'invoice',
  contract: readContract('invoice.schema.json'),
  templates: templatesFor('invoice', { 'invoice-global-v1': invoiceTemplate }),
  rules: rulesFor('invoice'),
  // GAP-10: the email rule needs a governed subject/body. One wildcard-
  // locale template (no locale-specific wording exists for invoices yet);
  // generic, no legal copy — see document-types/payslip.ts for the
  // locale-varying case.
  messageTemplates: [
    {
      meta: { id: 'invoice-email-global-v1', variant: { documentType: 'invoice' }, version: '1.0.0', lifecycle: 'published', provenance: 'human' },
      channel: 'email',
      subject: ['Invoice ', { expr: 'header.invoiceNumber' }],
      body: ['Invoice ', { expr: 'header.invoiceNumber' }, ' is attached.\n\nThis message was generated automatically.\n'],
    },
  ],
};
