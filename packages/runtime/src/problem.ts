/**
 * RFC 9457 (problem+json) error shapes (docs/STANDARDS.md Tier 2, ADR-006):
 * "every API error, including the rule-evaluation TRACE on non-match".
 * Ingress-time shapes (bad contract, unknown documentType, malformed
 * request body) plus the determination-time no-match shapes, which carry
 * the mandatory TRACE (HLD §9) as a problem+json extension member.
 */
import type { DeterminationTrace } from './determination/trace.js';

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
  /** RFC 9457 extension member: the full evaluated rule TRACE (HLD §9), never omitted on a determination non-match. */
  trace?: DeterminationTrace;
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

/** `POST /render` (OutputPort v1 `preview`): the named templateId is not
 * registered for this documentType. Preview never runs determination, so
 * the caller names the template explicitly and gets a plain 404 back. */
export function unknownTemplateProblem(documentType: string, templateId: string): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/unknown-template`,
    title: 'Unknown template',
    status: 404,
    detail: `templateId ${JSON.stringify(templateId)} is not registered for documentType ${JSON.stringify(documentType)}.`,
  };
}

/** `POST /render`: the renderer rejected the job. `error` is the renderer's
 * own message (template/engine facts) — never payload data. */
export function renderFailedProblem(templateId: string, error: string): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/render-failed`,
    title: 'Render failed',
    status: 500,
    detail: `Rendering template ${JSON.stringify(templateId)} failed: ${error}`,
  };
}

/** `POST /render`: the body names no usable `templateId`. */
export function missingTemplateIdProblem(): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/missing-template-id`,
    title: 'Missing templateId',
    status: 400,
    detail: 'Request body must carry a non-empty "templateId" string (preview renders exactly the template you name; it never runs determination).',
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

/**
 * No `OutputRule` matched the event (HLD §9, ADR-003). 422 Unprocessable
 * Entity: the request was syntactically fine and passed contract
 * validation (400 territory), but the server understands it cannot
 * determine an output for it — a semantic failure, not a malformed
 * request. Never a silent 2xx acceptance with nothing determined.
 */
export function noRuleMatchProblem(trace: DeterminationTrace): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/no-rule-match`,
    title: 'No output rule matched this event',
    status: 422,
    detail: `No OutputRule's conditions matched documentType "${trace.documentType}" / event "${trace.event}". See "trace" for every rule considered and why each did not match.`,
    trace,
  };
}

/**
 * A rule matched (channel + recipients resolved) but no template candidate
 * matches the resulting VariantKey — also a loud, distinct determination
 * failure, not folded into no-rule-match, so a caller can tell which half
 * of resolution failed at a glance.
 */
export function noTemplateMatchProblem(trace: DeterminationTrace): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/no-template-match`,
    title: 'No template matched the resolved variant',
    status: 422,
    detail: `Rule(s) "${trace.firingRuleIds.join(', ')}" fired, but at least one did not resolve a matching template candidate for its variant query. See "trace" for every firing rule's own template candidates considered and why each did not match.`,
    trace,
  };
}

/**
 * Rule(s) fired and every template resolved, but at least one firing rule
 * ended up with NO recipient — the rule's resolution names none and the
 * caller supplied no `determination.recipients` (Stage 4 clause 2 arb-chair
 * ruling: recipients are caller-supplied master data a rule may override).
 * Third distinct determination failure, same 422 + TRACE discipline; the
 * trace carries `recipientsSource: 'none'` on the offending resolution —
 * never any address (PII).
 */
export function unresolvedRecipientsProblem(trace: DeterminationTrace): ProblemDetails {
  const offending = trace.resolutions.filter((r) => r.recipientsSource === 'none').map((r) => r.ruleId);
  return {
    type: `${PROBLEM_BASE}/unresolved-recipients`,
    title: 'No recipients resolved for a firing rule',
    status: 422,
    detail: `Rule(s) "${offending.join(', ')}" fired, but neither the rule's resolution nor the event's "determination.recipients" supplied any recipient. Supply recipients on the event (caller master data) or on the rule (override). See "trace".`,
    trace,
  };
}

export function malformedCloudEventsProblem(detail: string): ProblemDetails {
  return {
    type: `${PROBLEM_BASE}/malformed-cloudevents-envelope`,
    title: 'Malformed CloudEvents 1.0 envelope',
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
