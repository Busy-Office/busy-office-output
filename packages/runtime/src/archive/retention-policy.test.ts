/**
 * retention-policy (ROADMAP Stage 4, "Retention per doc type enforced
 * end-to-end"). Proves retention genuinely varies by documentType
 * (invoice/payslip/purchase-order each get a different period) and that
 * an unknown documentType still gets a conservative, non-null fallback.
 */
import { describe, expect, it } from 'vitest';
import { retentionUntilFor, retentionYearsFor } from './retention-policy.js';

describe('retentionYearsFor', () => {
  it('varies by document type', () => {
    const poYears = retentionYearsFor('purchase-order');
    const invoiceYears = retentionYearsFor('invoice');
    const payslipYears = retentionYearsFor('payslip');

    // Genuinely different periods, not one constant reused everywhere.
    expect(new Set([poYears, invoiceYears, payslipYears]).size).toBeGreaterThan(1);
    expect(poYears).toBeGreaterThan(0);
    expect(invoiceYears).toBeGreaterThan(0);
    expect(payslipYears).toBeGreaterThan(0);
  });

  it('falls back to a conservative default for an unknown document type', () => {
    expect(retentionYearsFor('some-future-doc-type')).toBeGreaterThan(0);
  });
});

describe('retentionUntilFor', () => {
  it('adds the document type\'s retention period to the given `now`', () => {
    const now = new Date('2026-08-28T00:00:00Z');
    const invoiceUntil = retentionUntilFor('invoice', now);
    const payslipUntil = retentionUntilFor('payslip', now);
    const poUntil = retentionUntilFor('purchase-order', now);

    expect(new Date(invoiceUntil).getUTCFullYear()).toBe(2026 + retentionYearsFor('invoice'));
    expect(new Date(payslipUntil).getUTCFullYear()).toBe(2026 + retentionYearsFor('payslip'));
    expect(new Date(poUntil).getUTCFullYear()).toBe(2026 + retentionYearsFor('purchase-order'));

    // Distinct deadlines for distinct document types from the same `now`.
    expect(new Set([invoiceUntil, payslipUntil, poUntil]).size).toBe(3);
  });

  it('returns a valid RFC 3339 timestamp', () => {
    const until = retentionUntilFor('purchase-order', new Date('2026-08-28T00:00:00Z'));
    expect(() => new Date(until).toISOString()).not.toThrow();
    expect(Number.isNaN(Date.parse(until))).toBe(false);
  });
});
