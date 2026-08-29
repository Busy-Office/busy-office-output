/**
 * Determination (ROADMAP Stage 3, HLD §2 "Event API → Determination →
 * Composition → ..."). Resolves N `(template variant, channel, recipients,
 * locale)` resolutions for a validated event — HLD §4: "fan-out: one event
 * → N resolutions — bursting is fan-out, not a subsystem" (§2 diagram).
 *
 * Two halves, per resolution:
 *  - Rule matching: which `OutputRule`(s) fire, giving channel + recipients
 *    (+ optional locale/companyCode/country/partnerId overrides). See
 *    rule-types.ts's `OutputRule.fanOut` doc for the full co-firing design
 *    (opt-in, default false) and why.
 *  - Template resolution (REUSED, not reimplemented, per firing rule): the
 *    firing rule's overrides plus the event build a `VariantKey`, handed to
 *    `resolveTemplate` from `@busy-office/output-schema`
 *    (packages/schema/src/variant/resolve.ts, Stage 1) — the same
 *    most-specific-match algorithm docs/VARIANT-RESOLUTION.md specifies.
 *    `matchesVariant`/`specificityScore` (also from that module) are used
 *    here ONLY to build the human-readable per-candidate TRACE; the actual
 *    winner comes from calling `resolveTemplate` itself, so the trace can
 *    never disagree with the real decision.
 *
 * TRACE is mandatory on every call (HLD §9) — `determine()` always returns
 * one, whether it matched or not, and it is never collapsed across
 * resolutions: every firing rule gets its own `ResolutionTrace` (trace.ts),
 * while `trace.rules` still shows every rule that was EVALUATED (fired or
 * not), so "why didn't this rule ALSO fire" is always answerable.
 *
 * Atomicity: if ANY firing rule's template lookup fails, the whole
 * determination is `no-template-match` — no partial resolution set is ever
 * returned. Rationale: a partially-successful fan-out (some copies
 * archived, some silently missing) is exactly the kind of silent no-op
 * HLD §9 forbids; better to fail the whole event loudly, with a TRACE that
 * shows precisely which firing rule broke, than to under-deliver quietly.
 */
import {
  matchesVariant,
  resolveTemplate,
  specificityScore,
  type TemplateMeta,
  type VariantKey,
} from '@busy-office/output-schema';
import type { DeterminationContext, OutputRule } from './rule-types.js';
import type { DeterminationTrace, ResolutionTrace, RuleTraceEntry, TemplateTraceEntry } from './trace.js';

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
 *
 * Returns the firing set (rule-types.ts's `OutputRule.fanOut` doc): the
 * winner-take-all pick among matched NON-fan-out rules (highest
 * specificity, ties broken by `priority`, then file order — unchanged from
 * pre-fan-out `determine()`), followed by every matched `fanOut: true` rule
 * in file order. At most one non-fan-out rule ever fires; any number of
 * fan-out rules can.
 */
function evaluateRules(
  rules: readonly OutputRule[],
  ctx: DeterminationContext,
): { entries: RuleTraceEntry[]; firing: OutputRule[] } {
  const entries = rules.map((rule) => evaluateRule(rule, ctx));

  let winner: OutputRule | undefined;
  let winnerEntry: RuleTraceEntry | undefined;
  const fanOutMatches: OutputRule[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const entry = entries[i];
    if (!entry.matched) continue;

    if (rule.fanOut === true) {
      fanOutMatches.push(rule);
      continue;
    }

    if (
      winnerEntry === undefined ||
      entry.specificity > winnerEntry.specificity ||
      (entry.specificity === winnerEntry.specificity && entry.priority > winnerEntry.priority)
    ) {
      winner = rule;
      winnerEntry = entry;
    }
  }

  const firing = winner === undefined ? fanOutMatches : [winner, ...fanOutMatches];
  return { entries, firing };
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

/** One resolved `(template, channel, recipients, locale)` — one per firing rule. */
export interface Resolution {
  ruleId: string;
  templateId: string;
  templateVersion: string;
  channel: string;
  recipients: string[];
  locale?: string;
  /** The winning template's `TemplateMeta.renderer` — the per-template
   * renderer id (never a global setting, docs/UI-DESIGN.md absent-list)
   * that composition.ts resolves against its renderer registry. Optional
   * only so outbox rows minted before this field existed still redrive
   * (they fall back to the default renderer); every fresh resolution
   * carries it. */
  renderer?: string;
}

export type DeterminationResult =
  | {
      outcome: 'matched';
      /** Always non-empty — one entry per rule that fired (see rule-types.ts's `fanOut` doc). */
      resolutions: Resolution[];
      trace: DeterminationTrace;
    }
  | { outcome: 'no-rule-match'; trace: DeterminationTrace }
  | { outcome: 'no-template-match'; trace: DeterminationTrace };

export function determine(
  ctx: DeterminationContext,
  rules: readonly OutputRule[],
  templateCandidates: readonly TemplateMeta[],
): DeterminationResult {
  const { entries: ruleEntries, firing: firingRules } = evaluateRules(rules, ctx);

  if (firingRules.length === 0) {
    const trace: DeterminationTrace = {
      documentType: ctx.documentType,
      businessObject: ctx.businessObject,
      event: ctx.event,
      rules: ruleEntries,
      resolutions: [],
      outcome: 'no-rule-match',
      firingRuleIds: [],
    };
    return { outcome: 'no-rule-match', trace };
  }

  // Template resolution runs once per firing rule — each rule's own
  // resolution can confirm/override the variant fields the event itself
  // carried (rule-types.ts's OutputRuleResolution doc), so different firing
  // rules can legitimately query different variants for the same event.
  const resolutionTraces: ResolutionTrace[] = [];
  const resolutions: Resolution[] = [];
  let anyTemplateMissing = false;

  for (const rule of firingRules) {
    const variantQuery: VariantKey = {
      documentType: ctx.documentType,
      companyCode: rule.resolution.companyCode ?? ctx.companyCode,
      country: rule.resolution.country ?? ctx.country,
      partnerId: rule.resolution.partnerId ?? ctx.partnerId,
      locale: rule.resolution.locale ?? ctx.locale,
    };

    const { entries: templateEntries, winner: winningTemplate } = evaluateTemplateCandidates(
      templateCandidates,
      variantQuery,
    );

    resolutionTraces.push({
      ruleId: rule.id,
      variantQuery,
      templates: templateEntries,
      winningTemplateId: winningTemplate?.id,
    });

    if (winningTemplate === undefined) {
      anyTemplateMissing = true;
      continue;
    }

    resolutions.push({
      ruleId: rule.id,
      templateId: winningTemplate.id,
      templateVersion: winningTemplate.version,
      channel: rule.resolution.channel,
      recipients: rule.resolution.recipients,
      locale: variantQuery.locale,
      renderer: winningTemplate.renderer,
    });
  }

  const firingRuleIds = firingRules.map((r) => r.id);

  if (anyTemplateMissing) {
    // Atomic failure (see file header): even one firing rule failing its
    // template lookup fails the whole event, never a partial resolution set.
    const trace: DeterminationTrace = {
      documentType: ctx.documentType,
      businessObject: ctx.businessObject,
      event: ctx.event,
      rules: ruleEntries,
      resolutions: resolutionTraces,
      outcome: 'no-template-match',
      firingRuleIds,
    };
    return { outcome: 'no-template-match', trace };
  }

  const trace: DeterminationTrace = {
    documentType: ctx.documentType,
    businessObject: ctx.businessObject,
    event: ctx.event,
    rules: ruleEntries,
    resolutions: resolutionTraces,
    outcome: 'matched',
    firingRuleIds,
  };

  return { outcome: 'matched', resolutions, trace };
}
