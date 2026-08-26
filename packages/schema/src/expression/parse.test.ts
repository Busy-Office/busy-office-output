import { describe, expect, it } from 'vitest';
import { ExpressionParseError, parseExpression, parseRelativePath } from './parse.js';

describe('parseExpression', () => {
  it('parses a single-segment path rooted at a known identifier', () => {
    expect(parseExpression('lines').segments).toEqual(['lines']);
  });

  it('parses a multi-segment dot path', () => {
    expect(parseExpression('totals.grandTotal.amount').segments).toEqual(['totals', 'grandTotal', 'amount']);
  });

  it('accepts every known root identifier', () => {
    for (const root of ['schemaVersion', 'documentType', 'header', 'lines', 'totals']) {
      expect(() => parseExpression(root)).not.toThrow();
    }
  });

  it('rejects an unknown root identifier at publish time', () => {
    expect(() => parseExpression('secretApiKey')).toThrow(ExpressionParseError);
    expect(() => parseExpression('secretApiKey')).toThrow(/unknown root identifier/);
  });

  it('rejects a typo root identifier', () => {
    expect(() => parseExpression('haeder.poNumber')).toThrow(ExpressionParseError);
  });

  it('rejects malformed syntax: empty string', () => {
    expect(() => parseExpression('')).toThrow(ExpressionParseError);
  });

  it('rejects malformed syntax: array indexing', () => {
    expect(() => parseExpression('lines[0]')).toThrow(ExpressionParseError);
  });

  it('rejects malformed syntax: function call', () => {
    expect(() => parseExpression('sum(lines.netAmount)')).toThrow(ExpressionParseError);
  });

  it('rejects malformed syntax: a leading dot', () => {
    expect(() => parseExpression('.header')).toThrow(ExpressionParseError);
  });

  it('rejects an attempt to smuggle JavaScript', () => {
    expect(() => parseExpression('require("fs").readFileSync')).toThrow(ExpressionParseError);
  });
});

describe('parseRelativePath', () => {
  it('accepts a path with no envelope root at all (row-relative)', () => {
    expect(parseRelativePath('netAmount.amount').segments).toEqual(['netAmount', 'amount']);
  });

  it('accepts a single field name', () => {
    expect(parseRelativePath('description').segments).toEqual(['description']);
  });

  it('still rejects malformed syntax', () => {
    expect(() => parseRelativePath('netAmount[0]')).toThrow(ExpressionParseError);
    expect(() => parseRelativePath('')).toThrow(ExpressionParseError);
  });
});
