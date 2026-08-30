import { describe, expect, it } from 'vitest';
import {
  formatAddressLines,
  formatDisplayValue,
  formatIsoDateLocale,
  formatMoneyCents,
  formatMoneyCentsLocale,
  isAddressLike,
  isMoneyAmountPath,
  isRtlLocale,
  looksLikeIsoDate,
  UnformattableValueError,
} from './format.js';

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

describe('formatMoneyCentsLocale (Stage 6)', () => {
  it('falls back to the plain grouped-decimal format with no locale — pre-Stage-6 byte output is unaffected', () => {
    expect(formatMoneyCentsLocale(123456789)).toBe(formatMoneyCents(123456789));
  });
  it('formats en-SG with Latin-digit grouping', () => {
    expect(formatMoneyCentsLocale(123456789, 'en-SG')).toBe('1,234,567.89');
  });
  it('formats ar-SA with Arabic-Indic digit shapes', () => {
    expect(formatMoneyCentsLocale(123456789, 'ar-SA')).toMatch(/^[٠-٩٬٫]+$/);
  });
});

describe('looksLikeIsoDate', () => {
  it('matches a plain YYYY-MM-DD string', () => {
    expect(looksLikeIsoDate('2026-08-27')).toBe(true);
  });
  it('rejects non-date strings and non-strings', () => {
    expect(looksLikeIsoDate('Acme Corp')).toBe(false);
    expect(looksLikeIsoDate(123)).toBe(false);
    expect(looksLikeIsoDate(undefined)).toBe(false);
  });
});

describe('formatIsoDateLocale (Stage 6)', () => {
  it('passes the ISO string through unchanged with no locale', () => {
    expect(formatIsoDateLocale('2026-08-27')).toBe('2026-08-27');
  });
  it('formats en-SG as DD/MM/YYYY', () => {
    expect(formatIsoDateLocale('2026-08-27', 'en-SG')).toBe('27/08/2026');
  });
  it('formats ja-JP as YYYY/MM/DD', () => {
    expect(formatIsoDateLocale('2026-08-27', 'ja-JP')).toBe('2026/08/27');
  });
  it('formats th-TH in the Buddhist Era calendar (year + 543)', () => {
    expect(formatIsoDateLocale('2026-08-27', 'th-TH')).toBe('27/08/2569');
  });
});

describe('isAddressLike', () => {
  it('detects an Address-shaped object', () => {
    expect(isAddressLike({ line1: '1 Main St', city: 'Springfield', country: 'US' })).toBe(true);
  });
  it('rejects a plain string or a Party-shaped object', () => {
    expect(isAddressLike('1 Main St')).toBe(false);
    expect(isAddressLike({ name: 'Acme', address: {} })).toBe(false);
  });
});

describe('formatAddressLines (Stage 6)', () => {
  const address = { line1: '123 Industrial Way', city: 'Springfield', postalCode: '12345', country: 'US' };

  it('orders street line(s) before city+postal for the Western-order locales (en-SG, th-TH, ar-SA)', () => {
    for (const locale of ['en-SG', 'th-TH', 'ar-SA']) {
      const lines = formatAddressLines(address, locale);
      expect(lines[0]).toContain('123 Industrial Way');
      expect(lines[1]).toBe('Springfield 12345');
      expect(lines[2]).toBe('US');
    }
  });
  it('reverses to postal+city before the street line for ja-JP', () => {
    const lines = formatAddressLines(address, 'ja-JP');
    expect(lines[0]).toBe('12345 Springfield');
    expect(lines[1]).toContain('123 Industrial Way');
    expect(lines[2]).toBe('US');
  });
});

describe('isRtlLocale', () => {
  it('is true only for ar-SA among the four exit-gate locales', () => {
    expect(isRtlLocale('ar-SA')).toBe(true);
    expect(isRtlLocale('en-SG')).toBe(false);
    expect(isRtlLocale('ja-JP')).toBe(false);
    expect(isRtlLocale('th-TH')).toBe(false);
    expect(isRtlLocale(undefined)).toBe(false);
  });
});

describe('formatDisplayValue', () => {
  it('formats a money-amount-path number with the locale', () => {
    expect(formatDisplayValue('unitPrice.amount', 123456789, 'en-SG')).toBe('1,234,567.89');
  });
  it('formats an ISO-date-shaped string with the locale', () => {
    expect(formatDisplayValue('header.poDate', '2026-08-27', 'ja-JP')).toBe('2026/08/27');
  });
  it('joins an address value onto one comma-separated line', () => {
    const address = { line1: '123 Industrial Way', city: 'Springfield', postalCode: '12345', country: 'US' };
    expect(formatDisplayValue('header.buyer.address', address)).toBe('123 Industrial Way, Springfield 12345, US');
  });
  it('falls back to plain String() for everything else, and "" for null/undefined', () => {
    expect(formatDisplayValue('header.currency', 'USD')).toBe('USD');
    expect(formatDisplayValue('lineNumber', 3)).toBe('3');
    expect(formatDisplayValue('header.buyer.name', undefined)).toBe('');
    expect(formatDisplayValue('header.buyer.name', null)).toBe('');
  });

  /**
   * GAP-28 (corrected behavior, ruled 2026-08-30 "fail loudly"): a totals
   * row whose expression points at the Money OBJECT itself (a template
   * author's `totals.grandTotal` typo for the intended
   * `totals.grandTotal.amount`) is neither a money-amount path nor a
   * string/date/address shape. This used to fall all the way to plain
   * `String()`, stringifying the object as the literal text
   * "[object Object]" in the rendered document. It now throws
   * `UnformattableValueError` instead — this test documents the corrected
   * behavior, not the original bug.
   */
  it('GAP-28: a totals row pointing at the Money OBJECT (missing ".amount") throws UnformattableValueError instead of silently stringifying', () => {
    expect(() => formatDisplayValue('totals.grandTotal', { currency: 'USD', amount: 108 })).toThrow(
      UnformattableValueError,
    );
    expect(() => formatDisplayValue('totals.grandTotal', { currency: 'USD', amount: 108 })).toThrow(
      /totals\.grandTotal\.amount/,
    );
  });
});
