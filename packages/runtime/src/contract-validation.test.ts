import { describe, expect, it } from 'vitest';
import { isKnownDocumentType, validateContract } from './contract-validation.js';
import {
  invoiceMissingDueDate,
  purchaseOrderMissingPoNumber,
  validInvoice,
  validPayslip,
  validPurchaseOrder,
} from './fixtures.js';

describe('isKnownDocumentType', () => {
  it('recognizes the three Stage 1 contracts and rejects everything else', () => {
    expect(isKnownDocumentType('purchase-order')).toBe(true);
    expect(isKnownDocumentType('invoice')).toBe(true);
    expect(isKnownDocumentType('payslip')).toBe(true);
    expect(isKnownDocumentType('delivery-note')).toBe(false);
    expect(isKnownDocumentType(undefined)).toBe(false);
    expect(isKnownDocumentType(42)).toBe(false);
  });
});

describe('validateContract', () => {
  it('passes a genuinely valid purchase-order payload', () => {
    const result = validateContract('purchase-order', validPurchaseOrder());
    expect(result.valid).toBe(true);
  });

  it('fails a purchase-order payload missing a required field, naming it', () => {
    const result = validateContract('purchase-order', purchaseOrderMissingPoNumber());
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.message.includes('poNumber'))).toBe(true);
  });

  it('passes a genuinely valid invoice payload', () => {
    expect(validateContract('invoice', validInvoice()).valid).toBe(true);
  });

  it('fails an invoice payload missing a required field, naming it', () => {
    const result = validateContract('invoice', invoiceMissingDueDate());
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.message.includes('dueDate'))).toBe(true);
  });

  it('passes a genuinely valid payslip payload', () => {
    expect(validateContract('payslip', validPayslip()).valid).toBe(true);
  });

  it('rejects additional properties not in the contract (additionalProperties: false)', () => {
    const po = { ...validPurchaseOrder(), unexpectedField: 'nope' };
    const result = validateContract('purchase-order', po);
    expect(result.valid).toBe(false);
  });
});
