/**
 * OutputRule shapes (HLD §3: "OutputRule (conditions, resolution, priority)",
 * ADR-003 Accepted Option 1: files first — these are the JSON on-disk shape
 * loaded by load-rules.ts, one file per rule, from `packages/runtime/rules/
 * output-rules/*.json`. Deliberately plain JSON (not YAML): zero extra
 * parser dependency, and the whole point of files-first per ADR-003 is
 * diffability/reviewability, which JSON already gives for free.
 *
 * Conditions are evaluated as: `documentType` is mandatory and always exact
 * match (mirrors VariantKey's own documentType semantics in
 * packages/schema/src/document/template.ts); every other condition field is
 * optional on a rule — an absent field is a wildcard (matches any event),
 * a present field must equal the corresponding DeterminationContext field
 * exactly. This is deliberately the same wildcard-when-absent shape as
 * VariantKey/matchesVariant (docs/VARIANT-RESOLUTION.md), reused for
 * consistency of mental model, not by sharing code (rule conditions and
 * template variants are different domains: one routes channel+recipients,
 * the other picks a template body).
 */

export interface OutputRuleConditions {
  documentType: string;
  event?: string;
  businessObject?: string;
  companyCode?: string;
  country?: string;
  partnerId?: string;
}

/**
 * What a matching rule resolves to: channel + recipients are this task's
 * new DATA (delivery mechanics are a later, separate task — HLD §2's
 * Delivery box). `locale`/`companyCode`/`country`/`partnerId` here feed the
 * VariantKey query for the TEMPLATE half of resolution (confirm/override
 * what the event itself carried) — see determine.ts.
 */
export interface OutputRuleResolution {
  channel: string;
  /**
   * OPTIONAL since the Stage 4 clause-2 arb-chair ruling: recipients are
   * caller-supplied master data (`DeterminationContext.recipients`); a rule
   * overrides them when present. Precedence in determine.ts is exactly the
   * shape `locale` already uses — `rule.resolution.recipients ??
   * ctx.recipients` — so a fan-out "also copy to hr@" rule keeps working
   * (rule wins), while a channel-only rule routes to whoever the EVENT
   * named. Neither supplying any recipient is a loud, traced
   * `unresolved-recipients` determination failure, never an empty send.
   */
  recipients?: string[];
  locale?: string;
  companyCode?: string;
  country?: string;
  partnerId?: string;
}

export interface OutputRule {
  id: string;
  /** Explicit tiebreaker when two matching rules have equal specificity. Higher wins. Default 0. */
  priority?: number;
  /**
   * Fan-out opt-in (ROADMAP Stage 3 "Fan-out: one event → N resolutions").
   *
   * Design decision (recorded here, not just in the report, since this is
   * the field a rule author actually reads): co-firing is OPT-IN, default
   * `false`. Two disjoint matched-rule pools exist per event:
   *   - Every rule with `fanOut: true` that matches ALWAYS fires — each
   *     becomes its own independent resolution (own template lookup, own
   *     channel/recipients/locale, own registry row). These rules are
   *     understood to be additive/parallel by construction (e.g. "also
   *     archive a copy"), so there is no winner-take-all among them: if
   *     three fan-out rules match, all three fire.
   *   - Every rule WITHOUT `fanOut: true` (the default) still competes in
   *     the pre-existing winner-take-all pool: highest `specificity` wins,
   *     ties broken by `priority`, then file order — identical to
   *     pre-fan-out `determine()` behavior. At most one of these fires.
   * The event's final resolution set is the union: the winner-take-all
   * pick (if any matched) plus every fan-out match (if any matched). A
   * plain rule set with no `fanOut: true` rules therefore produces exactly
   * the same single resolution as before this task — existing rule files
   * and tests are unaffected by default.
   *
   * Why opt-in rather than "every match always fires" (the other option
   * this task's report weighs): most `OutputRule`s express mutually
   * exclusive alternatives for the SAME resolution (global vs.
   * companyCode-1000 routing for the same purchase order) — specificity
   * exists precisely to pick one of those, and "always fan out" would
   * silently turn every such override into a duplicate delivery. Making
   * co-firing an explicit, opt-in property on the rules that actually mean
   * "also fire this" keeps specificity's original job intact and makes
   * fan-out a deliberate authoring choice, not an emergent side effect of
   * how many rules happen to match.
   */
  fanOut?: boolean;
  conditions: OutputRuleConditions;
  resolution: OutputRuleResolution;
}

/**
 * The event-derived facts rule conditions are matched against. `documentType`
 * / `businessObject` / `event` always come from the validated ingress event
 * (contract documentType + BusinessEventKey). `companyCode`/`country`/
 * `partnerId`/`locale` are OPTIONAL, caller-supplied determination context —
 * see server.ts's `extractDeterminationContext` for exactly how they travel
 * on the wire (a judgment call flagged in this task's report: none of the
 * frozen data contracts carry these fields at top level, so they must come
 * from somewhere else if the caller wants finer-grained routing than
 * documentType/event alone).
 */
export interface DeterminationContext {
  documentType: string;
  businessObject: string;
  event: string;
  companyCode?: string;
  country?: string;
  partnerId?: string;
  locale?: string;
  /**
   * Caller-supplied master data (arb-chair ruling, Stage 4 exit-gate
   * clause 2; HLD §1 puts "holding master data" OUTSIDE the boundary — an
   * employee's mailbox is master data about the recipient, not content of
   * the payslip, so it never lives on a data contract). A rule overrides
   * when its resolution names recipients (`rule.resolution.recipients ??
   * ctx.recipients`, mirroring `locale`). NOT a rule-condition field
   * (never matched against, never in `RULE_CONDITION_FIELDS`) and NEVER
   * written into a `DeterminationTrace` — recipients are PII; the trace
   * records only WHERE they came from (`ResolutionTrace.recipientsSource`).
   */
  recipients?: string[];
}

/**
 * The caller-supplied half of `DeterminationContext` — everything the
 * event envelope's `determination` field (server.ts) or the embedded
 * module's `SubmitEventInput.determination` (embed/create-output.ts) may
 * carry. Both paths shape-validate it identically and nothing more.
 */
export type CallerDeterminationContext = Partial<
  Pick<DeterminationContext, 'companyCode' | 'country' | 'partnerId' | 'locale' | 'recipients'>
>;
