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
 * ROADMAP Stage 4 "Payslip: compact template + PII posture" added the
 * third entry: the `DocNode` tree for `TemplateMeta.id "payslip-global-v1"`
 * (packages/runtime/rules/templates/payslip-global.json), reused VERBATIM
 * from `test/corpus/payslip/template.ts`. "Compact" here means: header
 * identity block, one earnings/deductions line table, a totals block —
 * no per-document-type node kinds beyond the frozen nine, same as PO/
 * invoice. The PII posture is enforced everywhere else in the pipeline
 * (determination, composition, delivery, archive — CLAUDE.md, docs/POLICY.md);
 * this file only ever holds template STRUCTURE (field paths as expressions,
 * never literal data), so it carries no PII exposure of its own.
 *
 * This is explicitly NOT a general template-content registry/loader. Any
 * future documentType with a TemplateMeta row but no entry here resolves
 * fine through determination but composes to an honest, non-crashing
 * `'no-template-content'` outcome (`composition.ts`'s
 * `composeRenderArchiveAndEnqueue`) — never a 500 and never invented content.
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

const payslipTemplate: DocNode = {
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
          carryForward: 'amount.amount',
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

/**
 * ROADMAP Stage 4 "pdf-direct second renderer" (ADR-002 Accepted) added
 * the fourth entry: `payslip-companyCode-1000-v1`
 * (packages/runtime/rules/templates/payslip-companyCode-1000.json,
 * `"renderer": "pdf-direct"`). Same tree as `payslipTemplate` above with
 * ONE difference — no `carryForward` on the line table — because the
 * routing rule this task decided (bounded by ADR-001) is: pdf-direct
 * serves single-page, Latin-only, no-carry-forward documents, and the
 * renderer refuses a `carryForward` table outright rather than
 * approximating it. Reused VERBATIM from
 * `test/corpus/pdf-direct/templates.ts` (`payslipPdfDirectTemplate`),
 * where the pdf-direct corpus gates it (determinism, one page, veraPDF).
 * `payslip-global-v1` stays on Typst untouched — the 8,000-payslip burst
 * measurement in docs/RESULTS.md was made against it and remains valid.
 */
const payslipPdfDirectTemplate: DocNode = {
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

const TEMPLATE_CONTENT: Readonly<Record<string, DocNode>> = {
  'po-global-v1': purchaseOrderTemplate,
  'invoice-global-v1': invoiceTemplate,
  'payslip-global-v1': payslipTemplate,
  'payslip-companyCode-1000-v1': payslipPdfDirectTemplate,
};

/** Returns the hardcoded `DocNode` tree for `templateId`, or `undefined` if
 * this templateId has no content wired up yet (honest, not a crash). */
export function getTemplateContent(templateId: string): DocNode | undefined {
  return TEMPLATE_CONTENT[templateId];
}
