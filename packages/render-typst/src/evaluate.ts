/**
 * The evaluator packages/schema/src/expression/parse.ts deliberately stops
 * short of: parse.ts only validates syntax against the grammar, it never
 * evaluates against real data. Grammar is exactly docs/EXPRESSION-GRAMMAR.md — dot-paths only, no
 * operators/functions/indexing — so evaluation is exactly dot-path
 * traversal. This file must never grow beyond that; a real template need
 * that doesn't fit is a grammar gap to report, not a reason to extend this.
 */
import { parseExpression, parseRelativePath } from '@busy-office/output-schema';
import type { DataContractEnvelope } from '@busy-office/output-schema';

/** Walks `segments` through `root` via plain property access. Missing/`null` at any hop yields `undefined`. */
function walk(segments: readonly string[], root: unknown): unknown {
  let cur: unknown = root;
  for (const segment of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/** Evaluates an envelope-rooted expression (text.value, fieldGrid field.value, totals row.value, table.bind). */
export function evaluateExpression(raw: string, envelope: DataContractEnvelope): unknown {
  const parsed = parseExpression(raw);
  return walk(parsed.segments, envelope);
}

/** Evaluates a row-relative path (table column key) against one bound array element. */
export function evaluateRelative(raw: string, row: unknown): unknown {
  const parsed = parseRelativePath(raw);
  return walk(parsed.segments, row);
}
