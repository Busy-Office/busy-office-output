/**
 * Built-in `payslip` document type — both templates, moved VERBATIM from
 * the deleted `src/render/template-content.ts` (GAP-08):
 *
 *  - `payslip-global-v1` (rules/templates/payslip-global.json, Typst):
 *    ROADMAP Stage 4 "Payslip: compact template + PII posture", reused
 *    from `test/corpus/payslip/template.ts`. "Compact" = header identity
 *    block, one earnings/deductions line table, a totals block — no
 *    per-document-type node kinds beyond the frozen nine. The PII posture
 *    is enforced everywhere else in the pipeline (determination,
 *    composition, delivery, archive — CLAUDE.md, docs/POLICY.md); a
 *    template holds STRUCTURE only (field paths as expressions, never
 *    literal data), so it carries no PII exposure of its own. The 8,000-
 *    payslip burst measurement in docs/RESULTS.md was made against it.
 *  - `payslip-companyCode-1000-v1` (rules/templates/payslip-companyCode-
 *    1000.json, `"renderer": "pdf-direct"`): ROADMAP Stage 4 "pdf-direct
 *    second renderer" (ADR-002 Accepted). Same tree with ONE difference —
 *    no `carryForward` on the line table — because the routing rule that
 *    task decided (bounded by ADR-001) is: pdf-direct serves single-page,
 *    Latin-only, no-carry-forward documents, and the renderer refuses a
 *    `carryForward` table outright rather than approximating it. Reused
 *    from `test/corpus/pdf-direct/templates.ts` (`payslipPdfDirectTemplate`),
 *    where the pdf-direct corpus gates it (determinism, one page, veraPDF).
 *
 * Proven content, corpus-gated; do not "improve" or re-derive either tree.
 */
import type { DocNode } from '@busy-office/output-schema';
import type { DocumentTypeDefinition } from '../src/registration/document-type-definition.js';
import type { MessageTemplate } from '../src/message/message-template.js';
import { readContract, rulesFor, templatesFor } from './load-sources.js';

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

/**
 * Email message templates (GAP-10, maintainer decision 2026-08-29): the
 * subject/body a payslip email carries are TEMPLATES under this document
 * type's ownership — resolved by locale through the same most-specific
 * match as the document templates above, `published`, provenance `human`.
 * Two locales, deliberately different wording, so "varying by locale" is
 * real (the per-recipient gate exercises exactly these two). Short and
 * generic on purpose: no legal/HR copy. No wildcard-locale fallback: a
 * payslip email for a locale with no message template is an
 * `unresolved-message-template` determination failure, never a
 * default-subject send. Segments only — every non-literal is a named
 * expression under docs/EXPRESSION-GRAMMAR.md.
 */
const payslipEmailEnUS: MessageTemplate = {
  meta: {
    id: 'payslip-email-en-US-v1',
    variant: { documentType: 'payslip', locale: 'en-US' },
    version: '1.0.0',
    lifecycle: 'published',
    provenance: 'human',
  },
  channel: 'email',
  subject: ['Your payslip for the period ending ', { expr: 'header.payPeriodEnd' }],
  body: [
    'Hello ',
    { expr: 'header.employeeName' },
    ',\n\nYour payslip for the pay period ending ',
    { expr: 'header.payPeriodEnd' },
    ' is attached.\n\nThis message was generated automatically.\n',
  ],
};

const payslipEmailDeDE: MessageTemplate = {
  meta: {
    id: 'payslip-email-de-DE-v1',
    variant: { documentType: 'payslip', locale: 'de-DE' },
    version: '1.0.0',
    lifecycle: 'published',
    provenance: 'human',
  },
  channel: 'email',
  subject: ['Ihre Gehaltsabrechnung für den Zeitraum bis ', { expr: 'header.payPeriodEnd' }],
  body: [
    'Guten Tag ',
    { expr: 'header.employeeName' },
    ',\n\nIhre Gehaltsabrechnung für den Abrechnungszeitraum bis ',
    { expr: 'header.payPeriodEnd' },
    ' finden Sie im Anhang.\n\nDiese Nachricht wurde automatisch erstellt.\n',
  ],
};

export const payslip: DocumentTypeDefinition = {
  documentType: 'payslip',
  contract: readContract('payslip.schema.json'),
  templates: templatesFor('payslip', {
    'payslip-global-v1': payslipTemplate,
    'payslip-companyCode-1000-v1': payslipPdfDirectTemplate,
  }),
  rules: rulesFor('payslip'),
  // GAP-17: owner-supplied facts the engine used to hardcode by name.
  // 6 years — see archive/retention-policy.ts for the (non-legal) rationale.
  retentionYears: 6,
  // Owner-scoped: header.employeeId is the natural person this payslip is
  // about (opaque internal id, never logged). Drives ownerId at mint, the
  // default AuthorizationPort's hr-clerk/employee rule, and the console lock.
  ownerIdPath: 'header.employeeId',
  messageTemplates: [payslipEmailEnUS, payslipEmailDeDE],
};
