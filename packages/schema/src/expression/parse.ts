/**
 * Path A expression grammar (docs/EXPRESSION-GRAMMAR.md). Allowlisted,
 * no eval/imports/IO: the only thing this can express is a dot-separated
 * field path, and the root identifier must be a known envelope key.
 */

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Root identifiers a bound DataContractEnvelope actually has (docs/EXPRESSION-GRAMMAR.md). */
export const KNOWN_ROOT_IDENTIFIERS = ['schemaVersion', 'documentType', 'header', 'lines', 'totals'] as const;
export type KnownRootIdentifier = (typeof KNOWN_ROOT_IDENTIFIERS)[number];

export interface ParsedExpression {
  readonly raw: string;
  readonly segments: readonly string[];
}

export class ExpressionParseError extends Error {}

function parsePath(raw: string): ParsedExpression {
  if (raw.length === 0) {
    throw new ExpressionParseError('expression must not be empty');
  }
  const segments = raw.split('.');
  for (const segment of segments) {
    if (!IDENTIFIER.test(segment)) {
      throw new ExpressionParseError(`invalid identifier "${segment}" in expression "${raw}"`);
    }
  }
  return { raw, segments };
}

/**
 * Parses and publish-time-validates an envelope-rooted expression (text.value,
 * fieldGrid.fields[].value, table.bind, totals.rows[].value). Throws
 * ExpressionParseError on malformed syntax or an unknown root identifier —
 * never returns a partially-valid result.
 */
export function parseExpression(raw: string): ParsedExpression {
  const parsed = parsePath(raw);
  const root = parsed.segments[0]!;
  if (!(KNOWN_ROOT_IDENTIFIERS as readonly string[]).includes(root)) {
    throw new ExpressionParseError(
      `unknown root identifier "${root}" in expression "${raw}" — must be one of ${KNOWN_ROOT_IDENTIFIERS.join(', ')}`,
    );
  }
  return parsed;
}

/**
 * Parses a row-relative path (table.columns[].key) — same syntax as
 * parseExpression, but with no envelope root to check (docs/EXPRESSION-GRAMMAR.md).
 */
export function parseRelativePath(raw: string): ParsedExpression {
  return parsePath(raw);
}
