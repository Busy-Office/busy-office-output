/**
 * Determination unit tests (ROADMAP Stage 3 "Rule evaluation with mandatory
 * TRACE" + "Fan-out: one event → N resolutions" tasks). Exercises
 * `determine()` directly against small in-memory rule/template lists (not
 * the real files under rules/) so the match, no-match, and fan-out paths
 * are asserted against fixtures this file controls, not whatever happens
 * to live in packages/runtime/rules/ at test time.
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

describe('determine() — winner-take-all (fanOut absent/false, unchanged default behavior)', () => {
  it('matches the most specific rule and its matching template, carrying a non-empty TRACE', () => {
    const result = determine({ ...baseCtx, companyCode: '1000' }, rules, templates);

    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    // Exactly one resolution: no rule opts into fan-out in this fixture set.
    expect(result.resolutions).toHaveLength(1);
    const [resolution] = result.resolutions;
    expect(resolution.ruleId).toBe('po-companyCode-1000');
    expect(resolution.templateId).toBe('po-1000-v1');
    expect(resolution.channel).toBe('object-store');
    expect(resolution.recipients).toEqual(['archive://1000']);

    // Every rule was evaluated, not just the winner (mandatory full TRACE).
    expect(result.trace.rules).toHaveLength(2);
    expect(result.trace.rules.every((r) => typeof r.matched === 'boolean')).toBe(true);
    expect(result.trace.rules.some((r) => r.matched)).toBe(true);
    // One ResolutionTrace, for the one firing rule, with every template candidate evaluated.
    expect(result.trace.resolutions).toHaveLength(1);
    expect(result.trace.resolutions[0].templates).toHaveLength(2);
    expect(result.trace.outcome).toBe('matched');
    expect(result.trace.firingRuleIds).toEqual(['po-companyCode-1000']);
    expect(result.trace.resolutions[0].winningTemplateId).toBe('po-1000-v1');
  });

  it('falls back to the global rule when companyCode does not narrow it', () => {
    const result = determine(baseCtx, rules, templates);
    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].ruleId).toBe('po-global');
    expect(result.resolutions[0].templateId).toBe('po-global-v1');
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
    // Template resolution never runs without at least one firing rule — no-op path stays visible, not hidden.
    expect(result.trace.resolutions).toHaveLength(0);
    expect(result.trace.firingRuleIds).toEqual([]);
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
    expect(result.trace.firingRuleIds).toEqual(['invoice-only-rule']);
    expect(result.trace.resolutions).toHaveLength(1);
    expect(result.trace.resolutions[0].ruleId).toBe('invoice-only-rule');
    expect(result.trace.resolutions[0].templates).toHaveLength(2);
    expect(result.trace.resolutions[0].templates.every((t) => t.matched === false)).toBe(true);
    expect(result.trace.resolutions[0].winningTemplateId).toBeUndefined();
  });

  it('mandatory TRACE is present on the match path too, not just failures', () => {
    const result = determine(baseCtx, rules, templates);
    expect(result.trace).toBeDefined();
    expect(result.trace.rules.length).toBeGreaterThan(0);
    expect(result.trace.resolutions.length).toBeGreaterThan(0);
    expect(result.trace.resolutions[0].templates.length).toBeGreaterThan(0);
  });
});

describe('determine() — fan-out (fanOut: true rules co-fire alongside the winner)', () => {
  const invoiceTemplates: TemplateMeta[] = [
    { id: 'invoice-global-v1', variant: { documentType: 'invoice' }, version: '1.0.0', lifecycle: 'published', renderer: 'typst' },
  ];

  const invoiceRules: OutputRule[] = [
    {
      id: 'invoice-ap-email',
      conditions: { documentType: 'invoice', event: 'invoice.posted' },
      resolution: { channel: 'email', recipients: ['ap-clerk@example.com'] },
    },
    {
      id: 'invoice-archival-copy',
      fanOut: true,
      conditions: { documentType: 'invoice', event: 'invoice.posted' },
      resolution: { channel: 'object-store', recipients: ['archive://invoices'] },
    },
    {
      id: 'invoice-tax-authority-copy',
      fanOut: true,
      conditions: { documentType: 'invoice', event: 'invoice.posted' },
      resolution: { channel: 'object-store', recipients: ['archive://tax-authority'], locale: 'de-DE' },
    },
  ];

  const invoiceCtx: DeterminationContext = {
    documentType: 'invoice',
    businessObject: 'RBKP',
    event: 'invoice.posted',
  };

  it('one event matching a winner-take-all rule AND two fan-out rules produces 3 distinct resolutions', () => {
    const result = determine(invoiceCtx, invoiceRules, invoiceTemplates);

    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    expect(result.resolutions).toHaveLength(3);

    const byRuleId = new Map(result.resolutions.map((r) => [r.ruleId, r]));
    expect(byRuleId.get('invoice-ap-email')).toMatchObject({ channel: 'email', recipients: ['ap-clerk@example.com'] });
    expect(byRuleId.get('invoice-archival-copy')).toMatchObject({ channel: 'object-store', recipients: ['archive://invoices'] });
    expect(byRuleId.get('invoice-tax-authority-copy')).toMatchObject({
      channel: 'object-store',
      recipients: ['archive://tax-authority'],
      locale: 'de-DE',
    });

    // Every resolution independently traceable: one ResolutionTrace per firing rule.
    expect(result.trace.resolutions).toHaveLength(3);
    expect(result.trace.firingRuleIds).toEqual(['invoice-ap-email', 'invoice-archival-copy', 'invoice-tax-authority-copy']);
    // The full rule set was evaluated collectively, not just the ones that fired.
    expect(result.trace.rules).toHaveLength(3);
    expect(result.trace.rules.every((r) => r.matched)).toBe(true);
  });

  it('fan-out rules alone (no matching non-fan-out rule) still all fire — resolution set is not empty', () => {
    const onlyFanOut = invoiceRules.filter((r) => r.fanOut === true);
    const result = determine(invoiceCtx, onlyFanOut, invoiceTemplates);

    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    expect(result.resolutions).toHaveLength(2);
    expect(result.trace.firingRuleIds).toEqual(['invoice-archival-copy', 'invoice-tax-authority-copy']);
  });

  it('a non-matching fan-out rule does not fire and does not appear in the resolution set', () => {
    const withNonMatchingFanOut: OutputRule[] = [
      ...invoiceRules,
      {
        id: 'invoice-companyCode-9999-copy',
        fanOut: true,
        conditions: { documentType: 'invoice', event: 'invoice.posted', companyCode: '9999' },
        resolution: { channel: 'object-store', recipients: ['archive://9999'] },
      },
    ];
    const result = determine(invoiceCtx, withNonMatchingFanOut, invoiceTemplates);

    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    expect(result.resolutions).toHaveLength(3);
    expect(result.resolutions.some((r) => r.ruleId === 'invoice-companyCode-9999-copy')).toBe(false);
    // Still shows up in the full rule TRACE as evaluated-but-not-matched.
    const nonMatchEntry = result.trace.rules.find((r) => r.ruleId === 'invoice-companyCode-9999-copy');
    expect(nonMatchEntry?.matched).toBe(false);
  });

  it('two non-fan-out rules never both fire — specificity/priority still picks exactly one winner among them', () => {
    const competingRules: OutputRule[] = [
      {
        id: 'po-global',
        conditions: { documentType: 'purchase-order', event: 'po.released' },
        resolution: { channel: 'email', recipients: ['vendor@example.com'] },
      },
      {
        id: 'po-companyCode-1000',
        conditions: { documentType: 'purchase-order', event: 'po.released', companyCode: '1000' },
        resolution: { channel: 'object-store', recipients: ['archive://1000'], companyCode: '1000' },
      },
    ];
    const result = determine({ ...baseCtx, companyCode: '1000' }, competingRules, templates);

    expect(result.outcome).toBe('matched');
    if (result.outcome !== 'matched') throw new Error('unreachable');
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].ruleId).toBe('po-companyCode-1000');
  });
});
