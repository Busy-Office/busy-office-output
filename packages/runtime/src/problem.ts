/**
 * RFC 9457 (problem+json) error shapes (docs/STANDARDS.md Tier 2, ADR-006):
 * "every API error, including the rule-evaluation TRACE on non-match".
 * This module only carries the ingress-time shapes (bad contract, unknown
 * documentType, malformed request body); the rule-TRACE variant belongs to
 * the not-yet-built determination task.
 */

/** A single JSON Schema validation failure, shaped for API consumers (not a raw ajv dump). */
export interface SchemaValidationError {
  /** JSON Pointer into the payload, e.g. "/header/poNumber". */
  instancePath: string;
  /** JSON Pointer into the schema that rejected it. */
  schemaPath: string;
  /** ajv keyword that failed, e.g. "required", "pattern", "const". */
  keyword: string;
  /** Human-readable ajv message, e.g. "must have required property 'poNumber'". */
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: SchemaValidationError[];
}

const PROBLEM_BASE = 'https://busy-office.dev/problems';

export function invalidContractProblem(documentType: string, errors: SchemaValidationError[]): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/invalid-contract`,
    title: 'Data contract validation failed',
    status: 400,
    detail: `Payload for documentType "${documentType}" does not satisfy its data contract schema.`,
    errors,
  };
}

export function unknownDocumentTypeProblem(documentType: unknown): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/unknown-document-type`,
    title: 'Unrecognized documentType',
    status: 400,
    detail: `documentType ${JSON.stringify(documentType)} is not a known data contract.`,
  };
}

export function missingBusinessEventProblem(detail: string): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/missing-business-event`,
    title: 'Missing or malformed businessEvent envelope',
    status: 400,
    detail,
  };
}

export function malformedRequestProblem(detail: string): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/malformed-request`,
    title: 'Malformed request body',
    status: 400,
    detail,
  };
}

export function methodNotAllowedProblem(method: string | undefined): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/method-not-allowed`,
    title: 'Method not allowed',
    status: 405,
    detail: `${method ?? '(unknown)'} is not supported on this route; use POST.`,
  };
}

export function notFoundProblem(path: string | undefined): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/not-found`,
    title: 'Not found',
    status: 404,
    detail: `No route for ${path ?? '(unknown)'}.`,
  };
}
