import { describe, expect, it } from 'vitest';
import { formatMoneyCents, isMoneyAmountPath } from './format.js';

describe('formatMoneyCents', () => {
  it('formats whole thousands with grouping', () => {
    expect(formatMoneyCents(123456)).toBe('1,234.56');
  });
  it('formats small values without a spurious leading comma', () => {
    expect(formatMoneyCents(5)).toBe('0.05');
    expect(formatMoneyCents(0)).toBe('0.00');
  });
  it('formats negative cents with a leading minus', () => {
    expect(formatMoneyCents(-150)).toBe('-1.50');
  });
  it('groups large numbers correctly', () => {
    expect(formatMoneyCents(123456789)).toBe('1,234,567.89');
  });
});

describe('isMoneyAmountPath', () => {
  it('matches a bare "amount" and any dotted path ending in it', () => {
    expect(isMoneyAmountPath('amount')).toBe(true);
    expect(isMoneyAmountPath('unitPrice.amount')).toBe(true);
    expect(isMoneyAmountPath('totals.netTotal.amount')).toBe(true);
  });
  it('rejects unrelated paths', () => {
    expect(isMoneyAmountPath('currency')).toBe(false);
    expect(isMoneyAmountPath('lineNumber')).toBe(false);
  });
});
