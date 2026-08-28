/**
 * Direct unit test for `defaultAuthorizationPort` (ROADMAP Stage 4,
 * "Document-level authorization" — DoD: "HR-clerk vs employee test — same
 * endpoint, different outcome"). Pure function test, no HTTP: constructs a
 * `DocumentRegistryRow` by hand and calls `canAccess` with three different
 * `Actor`s against the SAME row/action, asserting three different
 * outcomes — proving authorization is evaluated against the document
 * (CLAUDE.md), not against which endpoint/action is invoked.
 */
import { describe, expect, it } from 'vitest';
import { defaultAuthorizationPort, type Actor } from './authorization-port.js';
import type { DocumentRegistryRow } from '../registry/registry-store.js';

function payslipRow(overrides: Partial<DocumentRegistryRow> = {}): DocumentRegistryRow {
  return {
    docId: 'doc-payslip-1',
    businessObject: 'PAYROLL',
    businessObjectId: 'PS-0001',
    event: 'payslip.issued',
    templateVersion: '1.0.0',
    rendererVersion: null,
    inputHash: null,
    outputHash: null,
    archiveRef: 'archive-ref-1',
    retentionUntil: '2032-01-01T00:00:00.000Z',
    purgedAt: null,
    ruleId: 'rule-1',
    documentType: 'payslip',
    ownerId: 'emp-1234',
    state: 'ORIGINAL',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    deliveryHistory: [],
    ...overrides,
  };
}

describe('defaultAuthorizationPort.canAccess — HR-clerk vs employee, same document', () => {
  const row = payslipRow();

  it('allows an hr-clerk actor to reproduce a payslip', () => {
    const hrClerk: Actor = { role: 'hr-clerk' };
    expect(defaultAuthorizationPort.canAccess(hrClerk, row, 'reproduce')).toBe(true);
  });

  it('denies an employee actor whose subjectId does not match the payslip owner', () => {
    const wrongEmployee: Actor = { role: 'employee', subjectId: 'emp-9999' };
    expect(defaultAuthorizationPort.canAccess(wrongEmployee, row, 'reproduce')).toBe(false);
  });

  it('allows an employee actor whose subjectId matches the payslip owner', () => {
    const matchingEmployee: Actor = { role: 'employee', subjectId: 'emp-1234' };
    expect(defaultAuthorizationPort.canAccess(matchingEmployee, row, 'reproduce')).toBe(true);
  });

  it('applies the same three outcomes across all three reprint actions', () => {
    const hrClerk: Actor = { role: 'hr-clerk' };
    const wrongEmployee: Actor = { role: 'employee', subjectId: 'emp-9999' };
    const matchingEmployee: Actor = { role: 'employee', subjectId: 'emp-1234' };

    for (const action of ['reproduce', 'regenerate', 'reissue'] as const) {
      expect(defaultAuthorizationPort.canAccess(hrClerk, row, action)).toBe(true);
      expect(defaultAuthorizationPort.canAccess(wrongEmployee, row, action)).toBe(false);
      expect(defaultAuthorizationPort.canAccess(matchingEmployee, row, action)).toBe(true);
    }
  });

  it('falls back to coarse default-allow for a non-payslip document type', () => {
    const purchaseOrderRow = payslipRow({ documentType: 'purchase-order', ownerId: null });
    const anyActor: Actor = { role: 'employee', subjectId: 'someone-else' };
    expect(defaultAuthorizationPort.canAccess(anyActor, purchaseOrderRow, 'reproduce')).toBe(true);
  });
});
