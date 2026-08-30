/**
 * Most-specific-match variant resolution (docs/VARIANT-RESOLUTION.md).
 * Pure functions only — no I/O, no registry access. Content merging over the
 * parentId chain is `merge.ts` in this same directory, not this file.
 */
import type { VariantKey, TemplateMeta } from '../document/template.js';

const OPTIONAL_FIELD_WEIGHTS: Array<[keyof Omit<VariantKey, 'documentType'>, number]> = [
  ['companyCode', 8],
  ['country', 4],
  ['partnerId', 2],
  ['locale', 1],
];

/** True iff every optional field the candidate sets equals the query's value. */
export function matchesVariant(candidate: VariantKey, query: VariantKey): boolean {
  if (candidate.documentType !== query.documentType) return false;
  for (const [field] of OPTIONAL_FIELD_WEIGHTS) {
    const candidateValue = candidate[field];
    if (candidateValue !== undefined && candidateValue !== query[field]) return false;
  }
  return true;
}

/** Weighted specificity score (docs/VARIANT-RESOLUTION.md §Most-specific-match rule). */
export function specificityScore(candidate: VariantKey): number {
  let score = 0;
  for (const [field, weight] of OPTIONAL_FIELD_WEIGHTS) {
    if (candidate[field] !== undefined) score += weight;
  }
  return score;
}

/**
 * Resolves the single most-specific matching template. First match wins on
 * an exact-score tie, i.e. resolution is stable on `candidates`' input order.
 *
 * Generic over anything that carries a `variant: VariantKey` (default —
 * `TemplateMeta`): a message template
 * (email subject/body, resolved per document type + locale under the SAME
 * most-specific-match rule, docs/VARIANT-RESOLUTION.md) is keyed by the
 * same `VariantKey` but is not a renderer-bearing `TemplateMeta`. One
 * resolver, one rule, no second implementation.
 */
export function resolveTemplate<T extends { variant: VariantKey } = TemplateMeta>(
  candidates: readonly T[],
  query: VariantKey,
): T | undefined {
  let best: T | undefined;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!matchesVariant(candidate.variant, query)) continue;
    const score = specificityScore(candidate.variant);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Walks `parentId` from `id` to the root, most-specific first. Throws on a
 * cycle rather than looping forever.
 */
export function resolveParentChain(id: string, byId: ReadonlyMap<string, TemplateMeta>): TemplateMeta[] {
  const chain: TemplateMeta[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = id;
  while (currentId !== undefined) {
    if (seen.has(currentId)) {
      throw new Error(`parentId cycle detected at template "${currentId}"`);
    }
    seen.add(currentId);
    const template = byId.get(currentId);
    if (!template) {
      throw new Error(`parentId chain references missing template "${currentId}"`);
    }
    chain.push(template);
    currentId = template.parentId;
  }
  return chain;
}
