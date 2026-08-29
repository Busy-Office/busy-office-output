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

/**
 * `unresolved-recipients` (Stage 4 exit-gate clause 2): rule(s) fired and
 * every template resolved, but at least one firing rule's resolution ended
 * up with NO recipient — neither the rule nor the caller's
 * `DeterminationContext.recipients` supplied any. Atomic like
 * `no-template-match`: one unresolvable resolution fails the whole event,
 * never an empty-array send for that copy alone.
 */
export type DeterminationOutcome =
  | 'matched'
  | 'no-rule-match'
  | 'no-template-match'
  | 'unresolved-recipients'
  /** GAP-10: rule(s) fired, templates and recipients resolved, but a
   * firing rule's channel carries a message (`email`) and no registered
   * message template matches its variant query. Atomic like the others;
   * `ResolutionTrace.messageTemplates` explains every candidate. Never a
   * bare-attachment fallback. */
  | 'unresolved-message-template';

/**
 * Where a resolution's recipients came from — recorded INSTEAD of the
 * recipients themselves (PII never enters the trace): `rule` (the rule's
 * own `resolution.recipients` won), `context` (the caller's
 * `DeterminationContext.recipients`), `none` (neither — the
 * `unresolved-recipients` outcome).
 */
export type RecipientsSource = 'rule' | 'context' | 'none';

/**
 * The template-resolution half of the TRACE for exactly ONE firing rule
 * (ROADMAP Stage 3 fan-out task). One event can now have zero, one, or many
 * of these — one per rule that actually fired (the winner-take-all pick,
 * plus every `fanOut: true` match, see rule-types.ts). Each carries its own
 * `variantQuery` because a fan-out rule's `resolution.locale`/`companyCode`/
 * `country`/`partnerId` overrides can differ from the winner's, so the same
 * event can legitimately query the template candidates differently per
 * firing rule (HLD's "email copy to AP + archival copy in a different
 * locale" example).
 */
export interface ResolutionTrace {
  ruleId: string;
  variantQuery: {
    documentType: string;
    companyCode?: string;
    country?: string;
    partnerId?: string;
    locale?: string;
  };
  /** Every template candidate evaluated for THIS firing rule's variant query. */
  templates: TemplateTraceEntry[];
  winningTemplateId?: string;
  /** See `RecipientsSource`. Never the addresses themselves. */
  recipientsSource: RecipientsSource;
  /** GAP-10: every message-template candidate evaluated for this firing
   * rule's variant query. Present only when the rule's channel carries a
   * message (`CHANNELS_REQUIRING_MESSAGE`); absent for `object-store`. */
  messageTemplates?: TemplateTraceEntry[];
  /** The message template that won — an ID only; the rendered subject/
   * body are PII and never enter the trace. */
  winningMessageTemplateId?: string;
}

export interface DeterminationTrace {
  documentType: string;
  businessObject: string;
  event: string;
  /** Every rule evaluated, exactly once, whether or not it matched or fired. */
  rules: RuleTraceEntry[];
  /**
   * One entry per rule that actually FIRED (winner-take-all pick + every
   * fan-out match), in firing order. Empty on `no-rule-match` (nothing
   * fired) and also empty on `no-template-match` is NOT guaranteed —
   * firing rules whose own template lookup failed still get an entry here,
   * with `winningTemplateId` undefined and `templates` explaining why, so a
   * human debugging "why didn't this ALSO fire" can see every rule that WAS
   * eligible to fire and where template resolution broke down for it.
   */
  resolutions: ResolutionTrace[];
  outcome: DeterminationOutcome;
  /** ruleIds that fired (winner-take-all pick, if any, + every fan-out match). */
  firingRuleIds: string[];
}
