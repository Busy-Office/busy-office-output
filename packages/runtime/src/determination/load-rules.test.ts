import { describe, expect, it } from 'vitest';
import { loadOutputRules, loadTemplateCandidates } from './load-rules.js';

describe('loadOutputRules / loadTemplateCandidates (files-first, ADR-003)', () => {
  it('loads every *.json rule file under rules/output-rules/, sorted by filename', () => {
    const rules = loadOutputRules();
    expect(rules.length).toBeGreaterThanOrEqual(4);
    const ids = rules.map((r) => r.id);
    expect(ids).toContain('po-default-email');
    expect(ids).toContain('invoice-default-email');
    expect(ids).toContain('payslip-default-email');
    expect(ids).toContain('payslip-country-DE-archive-copy');
    for (const rule of rules) {
      expect(rule.conditions.documentType).toEqual(expect.any(String));
      expect(rule.resolution.channel).toEqual(expect.any(String));
      // Recipients are OPTIONAL on a rule (Stage 4 clause 2 ruling: caller-
      // supplied master data, rule overrides) — when present, an array.
      if (rule.resolution.recipients !== undefined) {
        expect(Array.isArray(rule.resolution.recipients)).toBe(true);
      }
    }
    // The channel-only payslip rule is the one that relies on the caller.
    expect(rules.find((r) => r.id === 'payslip-default-email')?.resolution.recipients).toBeUndefined();
  });

  it('loads every *.json template candidate file under rules/templates/', () => {
    const templates = loadTemplateCandidates();
    expect(templates.length).toBeGreaterThanOrEqual(4);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('po-global-v1');
    expect(ids).toContain('invoice-global-v1');
    expect(ids).toContain('payslip-global-v1');
  });
});
