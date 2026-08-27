import { describe, expect, it } from 'vitest';
import type { DataContractEnvelope } from '@busy-office/output-schema';
import { evaluateExpression, evaluateRelative } from './evaluate.js';

const envelope: DataContractEnvelope = {
  schemaVersion: '1.0.0',
  documentType: 'purchase-order',
  header: { poNumber: 'PO-1', buyer: { name: 'Acme' } },
  lines: [{ netAmount: { amount: 500 } }],
  totals: { netTotal: { amount: 500 } } as unknown as Record<string, number>,
};

describe('evaluateExpression', () => {
  it('walks a dotted envelope path', () => {
    expect(evaluateExpression('header.poNumber', envelope)).toBe('PO-1');
    expect(evaluateExpression('header.buyer.name', envelope)).toBe('Acme');
  });
  it('returns undefined for a path that resolves through a missing field', () => {
    expect(evaluateExpression('header.missing.deeper', envelope)).toBeUndefined();
  });
  it('rejects an unknown root identifier (delegates to parseExpression)', () => {
    expect(() => evaluateExpression('notAField.x', envelope)).toThrow();
  });
});

describe('evaluateRelative', () => {
  it('walks a dotted path within a single row object', () => {
    const row = { netAmount: { amount: 42 } };
    expect(evaluateRelative('netAmount.amount', row)).toBe(42);
  });
});
