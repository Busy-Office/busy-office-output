/**
 * The payslip DocNode tree — kept byte-identical to the entry wired into
 * packages/runtime/src/render/template-content.ts under
 * `payslip-global-v1` (packages/runtime/rules/templates/payslip-global.json
 * carries that id). "Compact" per the task name: header identity block,
 * one earnings/deductions line table, a totals block — no node kind or
 * expression outside the frozen nine/the grammar (ROADMAP Stage 4 task
 * constraint: don't touch packages/schema/src/document/nodes.ts or
 * docs/EXPRESSION-GRAMMAR.md).
 */
import type { DocNode } from '@busy-office/output-schema';

export const payslipTemplate: DocNode = {
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
