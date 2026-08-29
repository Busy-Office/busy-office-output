/**
 * Direct unit test for the default `AuthorizationPort` (ROADMAP Stage 4,
 * "Document-level authorization" — DoD: "HR-clerk vs employee test — same
 * endpoint, different outcome"). Pure function test, no HTTP: constructs a
 * `DocumentRegistryRow` by hand and calls `canAccess` with three different
 * `Actor`s against the SAME row/action, asserting three different
 * outcomes — proving authorization is evaluated against the document
 * (CLAUDE.md), not against which endpoint/action is invoked.
 *
 * GAP-17: the port is built over a document-type registry — owner-scoping
 * comes from the registered definition's `ownerIdPath`, never from the
 * name 'payslip'. The built-in payslip is registered for the original
 * three outcomes; a test-local NON-payslip type that also supplies an
 * `ownerIdPath` must get exactly the same treatment.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultAuthorizationPort, extractOwnerId, type Actor } from './authorization-port.js';
import type { DocumentRegistryRow } from '../registry/registry-store.js';
import { createDocumentTypeRegistry } from '../registration/document-type-registry.js';
import type { DocumentTypeDefinition } from '../registration/document-type-definition.js';
import { payslip } from '../../document-types/payslip.js';
import { validPayslip } from '../fixtures.js';

/** A synthetic owner-scoped type with nothing payslip-like about it: a
 * locker assignment slip owned by the person at `header.assignee.id`. */
const lockerSlip: DocumentTypeDefinition = {
  documentType: 'locker-slip',
  contract: { $id: 'https://example.test/locker-slip.schema.json', type: 'object' },
  templates: [],
  rules: [],
  ownerIdPath: 'header.assignee.id',
};

const documentTypes = createDocumentTypeRegistry();
expect(documentTypes.register(payslip).status).toBe('registered');
expect(documentTypes.register(lockerSlip).status).toBe('registered');
const defaultAuthorizationPort = createDefaultAuthorizationPort(documentTypes);

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

describe('default AuthorizationPort.canAccess — HR-clerk vs employee, same document', () => {
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

  it('falls back to coarse default-allow for a type that is registered but not owner-scoped', () => {
    const memoTypes = createDocumentTypeRegistry();
    expect(memoTypes.register({ ...lockerSlip, documentType: 'plain-memo', ownerIdPath: undefined }).status).toBe('registered');
    const port = createDefaultAuthorizationPort(memoTypes);
    const memoRow = payslipRow({ documentType: 'plain-memo', ownerId: 'someone' });
    expect(port.canAccess({ role: 'employee', subjectId: 'someone-else' }, memoRow, 'reproduce')).toBe(true);
  });
});

describe('GAP-17: owner-scoping follows ownerIdPath, not the document-type name', () => {
  const row = payslipRow({ docId: 'doc-locker-1', documentType: 'locker-slip', event: 'locker.assigned', ownerId: 'emp-1234' });

  it('a non-payslip type that supplies ownerIdPath gets the same three outcomes', () => {
    expect(defaultAuthorizationPort.canAccess({ role: 'hr-clerk' }, row, 'reproduce')).toBe(true);
    expect(defaultAuthorizationPort.canAccess({ role: 'employee', subjectId: 'emp-9999' }, row, 'reproduce')).toBe(false);
    expect(defaultAuthorizationPort.canAccess({ role: 'employee', subjectId: 'emp-1234' }, row, 'reproduce')).toBe(true);
    // Fail-closed like a payslip: an unrecognized role is denied, not default-allowed.
    expect(defaultAuthorizationPort.canAccess({ role: 'auditor' }, row, 'reproduce')).toBe(false);
  });

  it('extractOwnerId evaluates the registered ownerIdPath with the frozen dot-path evaluator', () => {
    expect(extractOwnerId(documentTypes.ownerIdPath('payslip'), validPayslip())).toBe('EMP-00042');
    const slip = { schemaVersion: '1.0.0', documentType: 'locker-slip', header: { assignee: { id: 'emp-1234' } } };
    expect(extractOwnerId(documentTypes.ownerIdPath('locker-slip'), slip)).toBe('emp-1234');
    // No ownerIdPath (not owner-scoped, or unregistered) -> no owner recorded.
    expect(extractOwnerId(documentTypes.ownerIdPath('purchase-order'), validPayslip())).toBeUndefined();
    // A path that resolves to a non-string yields no owner rather than throwing mid-mint.
    expect(extractOwnerId('header', validPayslip())).toBeUndefined();
  });
});
