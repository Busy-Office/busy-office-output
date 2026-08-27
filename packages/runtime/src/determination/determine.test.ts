/**
 * Determination unit tests (ROADMAP Stage 3 "Rule evaluation with mandatory
 * TRACE" task). Exercises `determine()` directly against small in-memory
 * rule/template lists (not the real files under rules/) so the match and
 * no-match paths are asserted against fixtures this file controls, not
 * whatever happens to live in packages/runtime/rules/ at test time.
 */
import { describe, expect, it } from 'vitest';
import type { TemplateMeta } from '@busy-office/output-schema';
import { determine } from './determine.js';
import type { DeterminationContext, OutputRule } from './rule-types.js';

const rules: OutputRule[] = [
  {
    id: 'po-global',
    conditions: { documentType: 'purchase-order', event: 'po.released' },
    resolution: { channel: 'email', recipients: ['vendor@example.com'] },
  },
  {
    id: 'po-companyCode-1000',
    priority: 0,
    conditions: { documentType: 'purchase-order', event: 'po.released', companyCode: '1000' },
    resolution: { channel: 'object-store', recipients: ['archive://1000'], companyCode: '1000' },
  },
];

const templates: TemplateMeta[] = [
  { id: 'po-global-v1', variant: { documentType: 'purchase-order' }, version: '1.0.0', lifecycle: 'published', renderer: 'typst' },
  { id: 'po-1000-v1', variant: { documentType: 'purchase-order', companyCode: '1000' }, version: '2.0.0', lifecycle: 'published', renderer: 'typst' },
];

const baseCtx: DeterminationContext = {
  documentType: 'purchase-order',
  businessObject: 'EKKO',
  event: 'po.released',
};

describe('determine()', () => {
  it('matches the most specific rule and its matching template, carrying a non-empty TRACE', () => {
    const result = determine({ ...baseCtx, companyCode: '1000' }, rules, templates);

    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    expect(result.ruleId).toBe('po-companyCode-1000');
    expect(result.templateId).toBe('po-1000-v1');
    expect(result.channel).toBe('object-store');
    expect(result.recipients).toEqual(['archive://1000']);

    // Every rule was evaluated, not just the winner (mandatory full TRACE).
    expect(result.trace.rules).toHaveLength(2);
    expect(result.trace.rules.every((r) => typeof r.matched === 'boolean')).toBe(true);
    expect(result.trace.rules.some((r) => r.matched)).toBe(true);
    // Every template candidate was evaluated too.
    expect(result.trace.templates).toHaveLength(2);
    expect(result.trace.outcome).toBe('matched');
    expect(result.trace.winningRuleId).toBe('po-companyCode-1000');
    expect(result.trace.winningTemplateId).toBe('po-1000-v1');
  });

  it('falls back to the global rule when companyCode does not narrow it', () => {
    const result = determine(baseCtx, rules, templates);
    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    expect(result.ruleId).toBe('po-global');
    expect(result.templateId).toBe('po-global-v1');
  });

  it('no rule matches → outcome is no-rule-match, never a match, with a non-empty explanatory TRACE for every candidate', () => {
    const ctx: DeterminationContext = { ...baseCtx, event: 'po.cancelled' };
    const result = determine(ctx, rules, templates);

    expect(result.outcome).toBe('no-rule-match');
    expect(result.trace.outcome).toBe('no-rule-match');
    // TRACE proves every rule was actually considered, not skipped.
    expect(result.trace.rules).toHaveLength(2);
    for (const entry of result.trace.rules) {
      expect(entry.matched).toBe(false);
      expect(entry.reasons.length).toBeGreaterThan(0);
      expect(entry.reasons.some((r) => r.includes('po.cancelled'))).toBe(true);
    }
    // Template resolution never runs without a winning rule — no-op path stays visible, not hidden.
    expect(result.trace.templates).toHaveLength(0);
    expect(result.trace.winningRuleId).toBeUndefined();
  });

  it('rule matches but no template candidate matches the resolved variant → no-template-match, TRACE explains every candidate', () => {
    const noTemplateRules: OutputRule[] = [
      {
        id: 'invoice-only-rule',
        conditions: { documentType: 'invoice' },
        resolution: { channel: 'email', recipients: ['ap@example.com'] },
      },
    ];
    const ctx: DeterminationContext = { documentType: 'invoice', businessObject: 'RBKP', event: 'invoice.posted' };
    // `templates` only has purchase-order candidates — nothing matches documentType "invoice".
    const result = determine(ctx, noTemplateRules, templates);

    expect(result.outcome).toBe('no-template-match');
    expect(result.trace.outcome).toBe('no-template-match');
    expect(result.trace.winningRuleId).toBe('invoice-only-rule');
    expect(result.trace.templates).toHaveLength(2);
    expect(result.trace.templates.every((t) => t.matched === false)).toBe(true);
  });

  it('mandatory TRACE is present on the match path too, not just failures', () => {
    const result = determine(baseCtx, rules, templates);
    expect(result.trace).toBeDefined();
    expect(result.trace.rules.length).toBeGreaterThan(0);
    expect(result.trace.templates.length).toBeGreaterThan(0);
  });
});
