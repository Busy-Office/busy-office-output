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
  type TemplateLifecycle,
  type TemplateMeta,
  type VariantKey,
} from '@busy-office/output-schema';
import type { DeterminationContext, OutputRule } from './rule-types.js';
import type { DeterminationTrace, RecipientsSource, ResolutionTrace, RuleTraceEntry, TemplateTraceEntry } from './trace.js';
import { CHANNELS_REQUIRING_MESSAGE, type MessageTemplateMeta } from '../message/message-template.js';

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

/**
 * Stage 5 task 1 (arb-chair ruling 2026-08-29): ONLY `published` templates
 * are live candidates. A non-published candidate (draft/review/approved/
 * retired) is marked `matched: false` with a `lifecycle:` reason and is
 * NOT handed to `resolveTemplate` — but it STAYS in the trace (HLD §9: no
 * silent exclusion), so "why did my more-specific draft lose" is
 * answerable. Callers pass the CURRENT persisted lifecycle overlaid on each
 * meta (`createTemplateLifecycle().liveState`); this function trusts the
 * `lifecycle` field it is given. Applies to document AND message templates
 * alike — same function, same reason string.
 */
function evaluateTemplateCandidates<T extends { id: string; variant: VariantKey; lifecycle: TemplateLifecycle }>(
  candidates: readonly T[],
  query: VariantKey,
): { entries: TemplateTraceEntry[]; winner?: T } {
  const entries: TemplateTraceEntry[] = candidates.map((candidate) => {
    const live = candidate.lifecycle === 'published';
    const matched = live && matchesVariant(candidate.variant, query);
    const specificity = specificityScore(candidate.variant);
    const reasons: string[] = [];
    if (!live) {
      reasons.push(`lifecycle: ${candidate.lifecycle} — only published templates are live candidates`);
    }
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
  // Only the live (published) candidates are offered to it.
  const winner = resolveTemplate(
    candidates.filter((candidate) => candidate.lifecycle === 'published'),
    query,
  );
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
  /** GAP-10: the message template (email subject/body) that resolved for
   * this rule's channel, by ID — composition evaluates it at enqueue.
   * Present iff the channel carries a message (`CHANNELS_REQUIRING_MESSAGE`). */
  messageTemplateId?: string;
}

export type DeterminationResult =
  | {
      outcome: 'matched';
      /** Always non-empty — one entry per rule that fired (see rule-types.ts's `fanOut` doc). */
      resolutions: Resolution[];
      trace: DeterminationTrace;
    }
  | { outcome: 'no-rule-match'; trace: DeterminationTrace }
  | { outcome: 'no-template-match'; trace: DeterminationTrace }
  /** Rule(s) fired, templates resolved, but a firing rule has no recipient
   * from either the rule or the caller — see trace.ts's outcome doc. */
  | { outcome: 'unresolved-recipients'; trace: DeterminationTrace }
  /** GAP-10: a firing rule's channel carries a message but no message
   * template matches its variant query — see trace.ts's outcome doc. */
  | { outcome: 'unresolved-message-template'; trace: DeterminationTrace };

/**
 * `messageTemplateCandidates` (GAP-10): the registered message templates
 * (`DocumentTypeRegistry.messageTemplateMetas()`), resolved per firing
 * rule by the SAME `resolveTemplate` call and variant query the document
 * template uses — only for channels in `CHANNELS_REQUIRING_MESSAGE`.
 * `undefined` means message resolution was NOT requested (a caller
 * exercising rule/template logic alone — the determination unit tests);
 * an EMPTY array means "requested, nothing registered", which makes every
 * email resolution `unresolved-message-template`. The port
 * (embed/create-output.ts) always passes the registry's list, so the
 * runtime is strict end-to-end; only direct callers can opt out.
 */
export function determine(
  ctx: DeterminationContext,
  rules: readonly OutputRule[],
  templateCandidates: readonly TemplateMeta[],
  messageTemplateCandidates?: readonly MessageTemplateMeta[],
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
  let anyRecipientsMissing = false;
  let anyMessageTemplateMissing = false;

  for (const rule of firingRules) {
    const variantQuery: VariantKey = {
      documentType: ctx.documentType,
      companyCode: rule.resolution.companyCode ?? ctx.companyCode,
      country: rule.resolution.country ?? ctx.country,
      partnerId: rule.resolution.partnerId ?? ctx.partnerId,
      locale: rule.resolution.locale ?? ctx.locale,
    };

    // Recipients follow the exact precedence shape `locale` uses one line
    // above (arb-chair ruling, Stage 4 clause 2): the rule wins when it
    // names recipients, otherwise the caller's master data. The trace
    // records only the SOURCE — the addresses are PII and never enter it.
    const recipients = rule.resolution.recipients ?? ctx.recipients ?? [];
    const recipientsSource: RecipientsSource =
      rule.resolution.recipients !== undefined ? 'rule' : ctx.recipients !== undefined ? 'context' : 'none';

    const { entries: templateEntries, winner: winningTemplate } = evaluateTemplateCandidates(
      templateCandidates,
      variantQuery,
    );

    // GAP-10: a channel that carries a message (email) resolves its
    // subject/body template by the SAME variant query and the SAME
    // resolver — one rule, one trace shape, no second mechanism. The
    // trace records candidates and the winning ID only; the rendered text
    // (PII) is produced later, at enqueue, and never enters the trace.
    const message =
      messageTemplateCandidates !== undefined && CHANNELS_REQUIRING_MESSAGE.has(rule.resolution.channel)
        ? evaluateTemplateCandidates(messageTemplateCandidates, variantQuery)
        : undefined;

    resolutionTraces.push({
      ruleId: rule.id,
      variantQuery,
      templates: templateEntries,
      winningTemplateId: winningTemplate?.id,
      recipientsSource,
      ...(message !== undefined ? { messageTemplates: message.entries, winningMessageTemplateId: message.winner?.id } : {}),
    });

    if (winningTemplate === undefined) {
      anyTemplateMissing = true;
      continue;
    }
    if (recipients.length === 0) {
      // Every channel this runtime knows (email, object-store) needs at
      // least one destination; an empty list would be an empty-array send
      // — exactly the silent no-op HLD §9 forbids.
      anyRecipientsMissing = true;
      continue;
    }
    if (message !== undefined && message.winner === undefined) {
      // An email with no governed subject/body is not "an email with a
      // default subject" — it is an unresolved determination, loudly.
      anyMessageTemplateMissing = true;
      continue;
    }

    resolutions.push({
      ruleId: rule.id,
      templateId: winningTemplate.id,
      templateVersion: winningTemplate.version,
      channel: rule.resolution.channel,
      recipients,
      locale: variantQuery.locale,
      renderer: winningTemplate.renderer,
      ...(message?.winner !== undefined ? { messageTemplateId: message.winner.id } : {}),
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

  if (anyRecipientsMissing) {
    // Same atomicity as no-template-match (see file header): one firing
    // rule with nobody to deliver to fails the whole event loudly, with
    // `trace.resolutions[].recipientsSource === 'none'` pointing at it.
    const trace: DeterminationTrace = {
      documentType: ctx.documentType,
      businessObject: ctx.businessObject,
      event: ctx.event,
      rules: ruleEntries,
      resolutions: resolutionTraces,
      outcome: 'unresolved-recipients',
      firingRuleIds,
    };
    return { outcome: 'unresolved-recipients', trace };
  }

  if (anyMessageTemplateMissing) {
    // Same atomicity again: `trace.resolutions[].messageTemplates` shows
    // every message candidate considered for the offending rule and why
    // each did not match (typically: locale).
    const trace: DeterminationTrace = {
      documentType: ctx.documentType,
      businessObject: ctx.businessObject,
      event: ctx.event,
      rules: ruleEntries,
      resolutions: resolutionTraces,
      outcome: 'unresolved-message-template',
      firingRuleIds,
    };
    return { outcome: 'unresolved-message-template', trace };
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
