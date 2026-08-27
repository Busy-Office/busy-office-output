/**
 * Determination (ROADMAP Stage 3, HLD §2 "Event API → Determination →
 * Composition → ..."). Resolves ONE (template variant, channel, recipients)
 * for a validated event — fan-out (one event → N resolutions) is a
 * separate, later roadmap task and is deliberately NOT built here; see this
 * task's report for that scope boundary.
 *
 * Two halves:
 *  - Rule matching (NEW here): which `OutputRule` wins, giving channel +
 *    recipients (+ optional locale/companyCode/country/partnerId overrides).
 *  - Template resolution (REUSED, not reimplemented): the winning rule's
 *    overrides plus the event build a `VariantKey`, handed to
 *    `resolveTemplate` from `@busy-office/output-schema`
 *    (packages/schema/src/variant/resolve.ts, Stage 1) — the same
 *    most-specific-match algorithm docs/VARIANT-RESOLUTION.md specifies.
 *    `matchesVariant`/`specificityScore` (also from that module) are used
 *    here ONLY to build the human-readable per-candidate TRACE; the actual
 *    winner comes from calling `resolveTemplate` itself, so the trace can
 *    never disagree with the real decision.
 *
 * TRACE is mandatory on every call (HLD §9) — `determine()` always returns
 * one, whether it matched or not.
 */
import {
  matchesVariant,
  resolveTemplate,
  specificityScore,
  type TemplateMeta,
  type VariantKey,
} from '@busy-office/output-schema';
import type { DeterminationContext, OutputRule } from './rule-types.js';
import type { DeterminationTrace, RuleTraceEntry, TemplateTraceEntry } from './trace.js';

const RULE_CONDITION_FIELDS = ['event', 'businessObject', 'companyCode', 'country', 'partnerId'] as const;

function evaluateRule(rule: OutputRule, ctx: DeterminationContext): RuleTraceEntry {
  const reasons: string[] = [];
  let matched = true;
  let specificity = 0;

  if (rule.conditions.documentType === ctx.documentType) {
    reasons.push(`documentType: matched "${ctx.documentType}"`);
  } else {
    matched = false;
    reasons.push(
      `documentType: rule requires "${rule.conditions.documentType}", event has "${ctx.documentType}" — no match`,
    );
  }

  for (const field of RULE_CONDITION_FIELDS) {
    const want = rule.conditions[field];
    if (want === undefined) {
      reasons.push(`${field}: wildcard (rule does not constrain)`);
      continue;
    }
    specificity += 1;
    const have = ctx[field];
    if (want === have) {
      reasons.push(`${field}: matched "${have}"`);
    } else {
      matched = false;
      reasons.push(
        `${field}: rule requires "${want}", event has ${have === undefined ? '(none)' : `"${have}"`} — no match`,
      );
    }
  }

  return { ruleId: rule.id, matched, specificity, priority: rule.priority ?? 0, reasons };
}

/**
 * Evaluate every rule against ctx (mandatory full evaluation, not
 * short-circuit-on-first-match — the TRACE must show every candidate).
 * Winner: highest specificity among matches, ties broken by explicit
 * `priority` (higher wins), then first-in-array (stable on file order).
 */
function evaluateRules(
  rules: readonly OutputRule[],
  ctx: DeterminationContext,
): { entries: RuleTraceEntry[]; winner?: OutputRule } {
  const entries = rules.map((rule) => evaluateRule(rule, ctx));
  let winner: OutputRule | undefined;
  let winnerEntry: RuleTraceEntry | undefined;
  for (let i = 0; i < rules.length; i++) {
    const entry = entries[i];
    if (!entry.matched) continue;
    if (
      winnerEntry === undefined ||
      entry.specificity > winnerEntry.specificity ||
      (entry.specificity === winnerEntry.specificity && entry.priority > winnerEntry.priority)
    ) {
      winner = rules[i];
      winnerEntry = entry;
    }
  }
  return { entries, winner };
}

function evaluateTemplateCandidates(
  candidates: readonly TemplateMeta[],
  query: VariantKey,
): { entries: TemplateTraceEntry[]; winner?: TemplateMeta } {
  const entries: TemplateTraceEntry[] = candidates.map((candidate) => {
    const matched = matchesVariant(candidate.variant, query);
    const specificity = specificityScore(candidate.variant);
    const reasons: string[] = [];
    if (candidate.variant.documentType !== query.documentType) {
      reasons.push(
        `documentType: candidate requires "${candidate.variant.documentType}", query has "${query.documentType}" — no match`,
      );
    } else {
      reasons.push(`documentType: matched "${query.documentType}"`);
      const fields = ['companyCode', 'country', 'partnerId', 'locale'] as const;
      for (const field of fields) {
        const want = candidate.variant[field];
        if (want === undefined) {
          reasons.push(`${field}: wildcard (candidate does not constrain)`);
          continue;
        }
        const have = query[field];
        if (want === have) {
          reasons.push(`${field}: matched "${have}"`);
        } else {
          reasons.push(`${field}: candidate requires "${want}", query has ${have === undefined ? '(none)' : `"${have}"`} — no match`);
        }
      }
    }
    return { templateId: candidate.id, matched, specificity, reasons };
  });
  // The authoritative winner MUST come from resolveTemplate itself (Stage 1,
  // not reimplemented here) — never derived from the trace entries above.
  const winner = resolveTemplate(candidates, query);
  return { entries, winner };
}

export type DeterminationResult =
  | {
      outcome: 'matched';
      ruleId: string;
      templateId: string;
      templateVersion: string;
      channel: string;
      recipients: string[];
      locale?: string;
      trace: DeterminationTrace;
    }
  | { outcome: 'no-rule-match'; trace: DeterminationTrace }
  | { outcome: 'no-template-match'; trace: DeterminationTrace };

export function determine(
  ctx: DeterminationContext,
  rules: readonly OutputRule[],
  templateCandidates: readonly TemplateMeta[],
): DeterminationResult {
  const { entries: ruleEntries, winner: winningRule } = evaluateRules(rules, ctx);

  if (winningRule === undefined) {
    const trace: DeterminationTrace = {
      documentType: ctx.documentType,
      businessObject: ctx.businessObject,
      event: ctx.event,
      variantQuery: { documentType: ctx.documentType, companyCode: ctx.companyCode, country: ctx.country, partnerId: ctx.partnerId, locale: ctx.locale },
      rules: ruleEntries,
      templates: [],
      outcome: 'no-rule-match',
    };
    return { outcome: 'no-rule-match', trace };
  }

  // The winning rule's resolution can confirm/override the variant fields
  // the event itself carried (rule-types.ts's OutputRuleResolution doc).
  const variantQuery: VariantKey = {
    documentType: ctx.documentType,
    companyCode: winningRule.resolution.companyCode ?? ctx.companyCode,
    country: winningRule.resolution.country ?? ctx.country,
    partnerId: winningRule.resolution.partnerId ?? ctx.partnerId,
    locale: winningRule.resolution.locale ?? ctx.locale,
  };

  const { entries: templateEntries, winner: winningTemplate } = evaluateTemplateCandidates(
    templateCandidates,
    variantQuery,
  );

  if (winningTemplate === undefined) {
    const trace: DeterminationTrace = {
      documentType: ctx.documentType,
      businessObject: ctx.businessObject,
      event: ctx.event,
      variantQuery,
      rules: ruleEntries,
      templates: templateEntries,
      outcome: 'no-template-match',
      winningRuleId: winningRule.id,
    };
    return { outcome: 'no-template-match', trace };
  }

  const trace: DeterminationTrace = {
    documentType: ctx.documentType,
    businessObject: ctx.businessObject,
    event: ctx.event,
    variantQuery,
    rules: ruleEntries,
    templates: templateEntries,
    outcome: 'matched',
    winningRuleId: winningRule.id,
    winningTemplateId: winningTemplate.id,
  };

  return {
    outcome: 'matched',
    ruleId: winningRule.id,
    templateId: winningTemplate.id,
    templateVersion: winningTemplate.version,
    channel: winningRule.resolution.channel,
    recipients: winningRule.resolution.recipients,
    locale: variantQuery.locale,
    trace,
  };
}
