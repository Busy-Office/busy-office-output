/**
 * The mandatory TRACE (HLD §9: "No rule match → error carrying the full
 * evaluated TRACE (never silent)"; docs/STANDARDS.md Tier 2: "RFC 9457
 * problem+json | every API error, including the rule-evaluation TRACE on
 * non-match"). TRACE is produced on EVERY determination call — match or
 * no-match (HLD doesn't restrict it to failures only) — so callers can
 * always see which candidates were considered and why each did or didn't
 * win, not just when something went wrong.
 */

export interface RuleTraceEntry {
  ruleId: string;
  matched: boolean;
  /** Count of non-wildcard condition fields the rule set (tiebreak input). */
  specificity: number;
  priority: number;
  /** Human-readable, per-condition-field explanation — never the raw payload. */
  reasons: string[];
}

export interface TemplateTraceEntry {
  templateId: string;
  matched: boolean;
  specificity: number;
  reasons: string[];
}

export type DeterminationOutcome = 'matched' | 'no-rule-match' | 'no-template-match';

export interface DeterminationTrace {
  documentType: string;
  businessObject: string;
  event: string;
  /** The VariantKey query built for the template half of resolution. */
  variantQuery: {
    documentType: string;
    companyCode?: string;
    country?: string;
    partnerId?: string;
    locale?: string;
  };
  rules: RuleTraceEntry[];
  /** Empty when no rule matched — template resolution never runs without a winning rule. */
  templates: TemplateTraceEntry[];
  outcome: DeterminationOutcome;
  winningRuleId?: string;
  winningTemplateId?: string;
}
