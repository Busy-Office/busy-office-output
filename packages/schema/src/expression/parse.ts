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

/**
 * Parses and publish-time-validates an expression. Throws ExpressionParseError
 * on malformed syntax or an unknown root identifier — never returns a
 * partially-valid result.
 */
export function parseExpression(raw: string): ParsedExpression {
  if (raw.length === 0) {
    throw new ExpressionParseError('expression must not be empty');
  }
  const segments = raw.split('.');
  for (const segment of segments) {
    if (!IDENTIFIER.test(segment)) {
      throw new ExpressionParseError(`invalid identifier "${segment}" in expression "${raw}"`);
    }
  }
  const root = segments[0]!;
  if (!(KNOWN_ROOT_IDENTIFIERS as readonly string[]).includes(root)) {
    throw new ExpressionParseError(
      `unknown root identifier "${root}" in expression "${raw}" — must be one of ${KNOWN_ROOT_IDENTIFIERS.join(', ')}`,
    );
  }
  return { raw, segments };
}
