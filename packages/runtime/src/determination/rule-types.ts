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
  recipients: string[];
  locale?: string;
  companyCode?: string;
  country?: string;
  partnerId?: string;
}

export interface OutputRule {
  id: string;
  /** Explicit tiebreaker when two matching rules have equal specificity. Higher wins. Default 0. */
  priority?: number;
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
}
