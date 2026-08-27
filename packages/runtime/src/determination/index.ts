export { determine } from './determine.js';
export type { DeterminationResult, Resolution } from './determine.js';
export { loadOutputRules, loadTemplateCandidates, resetRuleCacheForTests } from './load-rules.js';
export type { OutputRule, OutputRuleConditions, OutputRuleResolution, DeterminationContext } from './rule-types.js';
export type {
  DeterminationTrace,
  DeterminationOutcome,
  ResolutionTrace,
  RuleTraceEntry,
  TemplateTraceEntry,
} from './trace.js';
