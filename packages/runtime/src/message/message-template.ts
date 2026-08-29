/**
 * Message templates (GAP-10, maintainer decision 2026-08-29, docs/
 * GAP-REGISTER.md): the email subject + body a delivery carries are
 * lifecycle-governed TEMPLATES, not operator-edited channel config. They
 * are per-document-type content, so their OWNER supplies them — a
 * `DocumentTypeDefinition.messageTemplates` entry next to `templates`
 * (GAP-08's registration inversion, unchanged) — and they are resolved by
 * the same `VariantKey` + most-specific-match rule as document templates
 * (`resolveTemplate`, packages/schema, docs/VARIANT-RESOLUTION.md).
 *
 * Shape decisions, each the smaller of two honest options:
 *  - `MessageTemplateMeta` is `TemplateMeta` minus `renderer`/`parentId`:
 *    a message has no renderer to target and (today) no inheritance
 *    chain. Same `id`/`variant`/`version`/`lifecycle`/`provenance`
 *    surface, so the Stage 5 lifecycle machinery governs both alike.
 *  - Subject and body are SEGMENT ARRAYS — each segment a literal string
 *    or `{ expr }` — evaluated with render-typst's `evaluateExpression`
 *    under the frozen docs/EXPRESSION-GRAMMAR.md. No `{{...}}` placeholder
 *    syntax was invented: every non-literal in the rendered text traces to
 *    a named, parseable expression, which is what makes "the body never
 *    contains a value not in the template's expressions" mechanically
 *    checkable (`messageTemplateExpressions` is the allowed set).
 *  - Rendering happens ONCE, at enqueue (composition.ts), never at send:
 *    the sender must not re-read the payload (CLAUDE.md: delivery never
 *    re-renders; the payload is gone by drain time). The rendered text
 *    rides on the delivery job (migrations/0011) and, like the recipients
 *    already there, is PII — never logged, never in the trace.
 */
import { parseExpression, type DataContractEnvelope, type TemplateMeta } from '@busy-office/output-schema';
import { evaluateExpression } from '@busy-office/render-typst';

/** A literal, or an envelope-rooted expression (docs/EXPRESSION-GRAMMAR.md). */
export type MessageSegment = string | { expr: string };

export interface MessageTemplateMeta extends Omit<TemplateMeta, 'renderer' | 'parentId'> {}

/** Channels whose delivery carries a human-readable message. `object-store`
 * does not (a dropped file has no subject line); adding a channel here is
 * a determination-time contract change, not a sender detail. */
export const CHANNELS_REQUIRING_MESSAGE: ReadonlySet<string> = new Set(['email']);

export interface MessageTemplate {
  meta: MessageTemplateMeta;
  /** The channel this message is for. Only `email` exists today. */
  channel: 'email';
  subject: readonly MessageSegment[];
  body: readonly MessageSegment[];
}

/** What a delivery job carries once a message template has been evaluated. */
export interface RenderedMessage {
  subject: string;
  body: string;
}

/** Every distinct expression the template evaluates, subject then body.
 * The mechanically-checkable "allowed set" of non-literal content. */
export function messageTemplateExpressions(template: Pick<MessageTemplate, 'subject' | 'body'>): string[] {
  const out: string[] = [];
  for (const segment of [...template.subject, ...template.body]) {
    if (typeof segment !== 'string' && !out.includes(segment.expr)) out.push(segment.expr);
  }
  return out;
}

/** Registration-time structural check. `path` prefixes each problem's
 * locator; returns `[]` for a well-formed template. Every `expr` must parse
 * under the frozen grammar, so a template can never carry an expression
 * the evaluator would reject at enqueue. */
export function checkMessageTemplate(template: MessageTemplate, path: string): Array<{ path: string; message: string }> {
  const problems: Array<{ path: string; message: string }> = [];
  if (template.channel !== 'email') {
    problems.push({ path: `${path}.channel`, message: `message template channel must be "email", got ${JSON.stringify(template.channel)}` });
  }
  for (const part of ['subject', 'body'] as const) {
    const segments = template[part];
    if (!Array.isArray(segments) || segments.length === 0) {
      problems.push({ path: `${path}.${part}`, message: `${part} must be a non-empty array of segments` });
      continue;
    }
    segments.forEach((segment, i) => {
      if (typeof segment === 'string') return;
      if (segment === null || typeof segment !== 'object' || typeof segment.expr !== 'string') {
        problems.push({ path: `${path}.${part}[${i}]`, message: 'segment must be a string or { expr: string }' });
        return;
      }
      try {
        parseExpression(segment.expr);
      } catch (err) {
        problems.push({ path: `${path}.${part}[${i}].expr`, message: err instanceof Error ? err.message : String(err) });
      }
    });
  }
  return problems;
}

function renderSegments(segments: readonly MessageSegment[], envelope: DataContractEnvelope, part: string): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'string') {
      out += segment;
      continue;
    }
    const value = evaluateExpression(segment.expr, envelope);
    // Only scalars may be interpolated: an object/array/undefined here is
    // a template that names a path the contract does not fill — a
    // template bug reported by expression NAME, never by value.
    if (value === undefined || value === null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) {
      throw new Error(`message template ${part}: expression "${segment.expr}" did not evaluate to a scalar`);
    }
    out += String(value);
  }
  return out;
}

/** Evaluate subject + body against the payload. Throws (by expression
 * name, never value) when an expression yields a non-scalar. */
export function renderMessage(template: MessageTemplate, envelope: DataContractEnvelope): RenderedMessage {
  return {
    subject: renderSegments(template.subject, envelope, 'subject'),
    body: renderSegments(template.body, envelope, 'body'),
  };
}
