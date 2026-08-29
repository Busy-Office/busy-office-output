import { describe, expect, it } from 'vitest';
import { createContractCompiler } from './contract-validation.js';
import { createDocumentTypeRegistry } from './registration/document-type-registry.js';
import { builtinDocumentTypes } from '../document-types/index.js';
import {
  invoiceMissingDueDate,
  purchaseOrderMissingPoNumber,
  validInvoice,
  validPayslip,
  validPurchaseOrder,
} from './fixtures.js';

/**
 * Contract validation after GAP-08: the engine compiles whatever contract
 * a `DocumentTypeDefinition` carries; it knows no document type itself.
 * These tests register the built-ins (a test file may import
 * document-types/; engine files may not) and assert the SAME verdicts the
 * hardcoded validators used to give.
 */
function builtinRegistry() {
  const registry = createDocumentTypeRegistry();
  for (const definition of builtinDocumentTypes) {
    expect(registry.register(definition).status).toBe('registered');
  }
  return registry;
}

describe('DocumentTypeRegistry.has', () => {
  it('recognizes the three registered built-ins and rejects everything else', () => {
    const registry = builtinRegistry();
    expect(registry.has('purchase-order')).toBe(true);
    expect(registry.has('invoice')).toBe(true);
    expect(registry.has('payslip')).toBe(true);
    expect(registry.has('delivery-note')).toBe(false);
    expect(registry.has(undefined)).toBe(false);
    expect(registry.has(42)).toBe(false);
  });

  it('an empty registry knows nothing — the engine has no built-in document type', () => {
    expect(createDocumentTypeRegistry().has('purchase-order')).toBe(false);
  });
});

describe('DocumentTypeRegistry.validate (compiled contracts)', () => {
  const registry = builtinRegistry();

  it('passes a genuinely valid purchase-order payload', () => {
    expect(registry.validate('purchase-order', validPurchaseOrder()).valid).toBe(true);
  });

  it('fails a purchase-order payload missing a required field, naming it', () => {
    const result = registry.validate('purchase-order', purchaseOrderMissingPoNumber());
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.message.includes('poNumber'))).toBe(true);
  });

  it('passes a genuinely valid invoice payload', () => {
    expect(registry.validate('invoice', validInvoice()).valid).toBe(true);
  });

  it('fails an invoice payload missing a required field, naming it', () => {
    const result = registry.validate('invoice', invoiceMissingDueDate());
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.message.includes('dueDate'))).toBe(true);
  });

  it('passes a genuinely valid payslip payload (x-pii annotation accepted under strict mode)', () => {
    expect(registry.validate('payslip', validPayslip()).valid).toBe(true);
  });

  it('rejects additional properties not in the contract (additionalProperties: false)', () => {
    const po = { ...validPurchaseOrder(), unexpectedField: 'nope' };
    expect(registry.validate('purchase-order', po).valid).toBe(false);
  });

  it('resolves the shared common.schema.json $refs the built-in contracts embed (a bad currency code is caught)', () => {
    const po = validPurchaseOrder();
    const bad = { ...po, header: { ...po.header, currency: 'usd' } };
    const result = registry.validate('purchase-order', bad);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.instancePath === '/header/currency')).toBe(true);
  });

  it('throws for an unregistered documentType — callers check has() first', () => {
    expect(() => registry.validate('delivery-note', {})).toThrow(/not registered/);
  });
});

describe('createContractCompiler', () => {
  it('reports a schema that fails strict-mode compilation instead of throwing', () => {
    const compiler = createContractCompiler();
    const result = compiler.compile({ type: 'object', notAKeyword: true });
    expect(result.ok).toBe(false);
  });

  it('compiles a minimal valid schema and validates against it', () => {
    const compiler = createContractCompiler();
    const result = compiler.compile({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.validate({ a: 'x' }).valid).toBe(true);
    expect(result.contract.validate({}).valid).toBe(false);
  });
});
