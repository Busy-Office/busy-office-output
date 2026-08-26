import { describe, expect, it } from 'vitest';
import { matchesVariant, resolveParentChain, resolveTemplate, specificityScore } from './resolve.js';
import type { TemplateMeta } from '../document/template.js';

function template(id: string, variant: TemplateMeta['variant'], parentId?: string): TemplateMeta {
  return {
    id,
    variant,
    version: '1.0.0',
    parentId,
    lifecycle: 'published',
    renderer: 'typst',
  };
}

const candidates: TemplateMeta[] = [
  template('T-global', { documentType: 'purchase-order' }),
  template('T-sg', { documentType: 'purchase-order', country: 'SG' }),
  template('T-sg-en', { documentType: 'purchase-order', country: 'SG', locale: 'en-SG' }),
  template('T-acme-sg', { documentType: 'purchase-order', companyCode: '1000', country: 'SG' }),
  template('T-acme-vendorX', { documentType: 'purchase-order', companyCode: '1000', partnerId: 'vendor-X' }),
];

describe('matchesVariant', () => {
  it('rejects a different documentType', () => {
    expect(matchesVariant({ documentType: 'invoice' }, { documentType: 'purchase-order' })).toBe(false);
  });

  it('treats an unset candidate field as a wildcard', () => {
    expect(matchesVariant({ documentType: 'purchase-order' }, { documentType: 'purchase-order', country: 'SG' })).toBe(true);
  });

  it('rejects a candidate field that disagrees with the query', () => {
    expect(matchesVariant({ documentType: 'purchase-order', country: 'SG' }, { documentType: 'purchase-order', country: 'TH' })).toBe(false);
  });

  it('rejects a candidate field the query never supplied', () => {
    expect(matchesVariant({ documentType: 'purchase-order', locale: 'en-SG' }, { documentType: 'purchase-order', country: 'SG' })).toBe(false);
  });
});

describe('specificityScore', () => {
  it('weights companyCode > country > partnerId > locale', () => {
    expect(specificityScore({ documentType: 'purchase-order', companyCode: '1000' })).toBe(8);
    expect(specificityScore({ documentType: 'purchase-order', country: 'SG', partnerId: 'vendor-X', locale: 'en-SG' })).toBe(7);
  });

  it('is zero for a fully wildcard variant', () => {
    expect(specificityScore({ documentType: 'purchase-order' })).toBe(0);
  });
});

describe('resolveTemplate — worked examples (docs/VARIANT-RESOLUTION.md)', () => {
  it('picks companyCode+country over companyCode+partnerId', () => {
    const resolved = resolveTemplate(candidates, {
      documentType: 'purchase-order',
      companyCode: '1000',
      country: 'SG',
      partnerId: 'vendor-X',
      locale: 'en-SG',
    });
    expect(resolved?.id).toBe('T-acme-sg');
  });

  it('falls back to a wildcard-companyCode candidate when companyCode has no match', () => {
    const resolved = resolveTemplate(candidates, {
      documentType: 'purchase-order',
      companyCode: '9999',
      country: 'SG',
    });
    expect(resolved?.id).toBe('T-sg');
  });

  it('returns undefined when documentType has no candidate at all', () => {
    const resolved = resolveTemplate(candidates, { documentType: 'invoice' });
    expect(resolved).toBeUndefined();
  });

  it('first match wins on an exact specificity tie', () => {
    const tied: TemplateMeta[] = [
      template('T-first', { documentType: 'purchase-order', country: 'SG' }),
      template('T-second', { documentType: 'purchase-order', country: 'SG' }),
    ];
    const resolved = resolveTemplate(tied, { documentType: 'purchase-order', country: 'SG' });
    expect(resolved?.id).toBe('T-first');
  });
});

describe('resolveParentChain', () => {
  it('walks most-specific first to the root', () => {
    const byId = new Map<string, TemplateMeta>([
      ['T-child', template('T-child', { documentType: 'purchase-order' }, 'T-parent')],
      ['T-parent', template('T-parent', { documentType: 'purchase-order' }, 'T-root')],
      ['T-root', template('T-root', { documentType: 'purchase-order' })],
    ]);
    const chain = resolveParentChain('T-child', byId);
    expect(chain.map((t) => t.id)).toEqual(['T-child', 'T-parent', 'T-root']);
  });

  it('throws on a parentId cycle', () => {
    const byId = new Map<string, TemplateMeta>([
      ['A', template('A', { documentType: 'purchase-order' }, 'B')],
      ['B', template('B', { documentType: 'purchase-order' }, 'A')],
    ]);
    expect(() => resolveParentChain('A', byId)).toThrow(/cycle/);
  });

  it('throws when the chain references a missing template', () => {
    const byId = new Map<string, TemplateMeta>([
      ['A', template('A', { documentType: 'purchase-order' }, 'missing')],
    ]);
    expect(() => resolveParentChain('A', byId)).toThrow(/missing/);
  });
});
