/**
 * Hand-built payloads for tests, valid against packages/schema/contracts.
 * Not corpus data (the generators under test/corpus own that, Stage 2) —
 * just enough to exercise ingress + contract validation.
 */
import type { InvoiceData, PayslipData, PurchaseOrderData } from '@busy-office/output-schema';

const buyer = {
  name: 'Acme Buyer Corp',
  address: { line1: '1 Industrial Way', city: 'Springfield', postalCode: '62704', country: 'US' },
};

const vendor = {
  name: 'Northwind Vendor Ltd',
  address: { line1: '2 Harbor Road', city: 'Rivertown', postalCode: '10101', country: 'US' },
};

export function validPurchaseOrder(): PurchaseOrderData {
  return {
    schemaVersion: '1.0.0',
    documentType: 'purchase-order',
    header: {
      poNumber: 'PO-000123',
      poDate: '2026-08-27',
      currency: 'USD',
      buyer,
      vendor,
    },
    lines: [
      {
        lineNumber: 1,
        materialId: 'MAT-10001',
        description: 'Bracket',
        quantity: 10,
        unitOfMeasure: 'EA',
        unitPrice: { currency: 'USD', amount: 500 },
        netAmount: { currency: 'USD', amount: 5000 },
      },
    ],
    totals: {
      netTotal: { currency: 'USD', amount: 5000 },
      taxTotal: { currency: 'USD', amount: 400 },
      grandTotal: { currency: 'USD', amount: 5400 },
    },
  };
}

/** Missing header.poNumber (required) — used to assert 400 + schema errors. */
export function purchaseOrderMissingPoNumber(): unknown {
  const po = validPurchaseOrder();
  const { poNumber, ...headerRest } = po.header;
  return { ...po, header: headerRest };
}

export function validInvoice(): InvoiceData {
  return {
    schemaVersion: '1.0.0',
    documentType: 'invoice',
    header: {
      invoiceNumber: 'INV-000456',
      invoiceDate: '2026-08-27',
      dueDate: '2026-09-26',
      currency: 'USD',
      seller: vendor,
      buyer,
    },
    lines: [
      {
        lineNumber: 1,
        description: 'Consulting hours',
        quantity: 8,
        unitOfMeasure: 'EA',
        unitPrice: { currency: 'USD', amount: 10000 },
        taxRate: 0.08,
        netAmount: { currency: 'USD', amount: 80000 },
      },
    ],
    totals: {
      netTotal: { currency: 'USD', amount: 80000 },
      taxTotal: { currency: 'USD', amount: 6400 },
      grandTotal: { currency: 'USD', amount: 86400 },
    },
  };
}

/** Missing header.dueDate (required) — used to assert 400 + schema errors. */
export function invoiceMissingDueDate(): unknown {
  const invoice = validInvoice();
  const { dueDate, ...headerRest } = invoice.header;
  return { ...invoice, header: headerRest };
}

export function validPayslip(): PayslipData {
  return {
    schemaVersion: '1.0.0',
    documentType: 'payslip',
    header: {
      payslipNumber: 'PS-000789',
      payPeriodStart: '2026-08-01',
      payPeriodEnd: '2026-08-31',
      payDate: '2026-09-01',
      currency: 'USD',
      employer: vendor,
      employeeId: 'EMP-00042',
      employeeName: 'Jordan Rivera',
    },
    lines: [
      { lineNumber: 1, code: 'BASIC', description: 'Base salary', type: 'earning', amount: { currency: 'USD', amount: 500000 } },
      { lineNumber: 2, code: 'TAX', description: 'Income tax', type: 'deduction', amount: { currency: 'USD', amount: 50000 } },
    ],
    totals: {
      grossPay: { currency: 'USD', amount: 500000 },
      totalDeductions: { currency: 'USD', amount: 50000 },
      netPay: { currency: 'USD', amount: 450000 },
    },
  };
}
