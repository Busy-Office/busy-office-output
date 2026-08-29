/**
 * `DocumentTypeDefinition` — the unit of registration for OutputPort v1's
 * fifth verb, `registerDocumentType` (GAP-07 / GAP-08, arb-chair ruling
 * 2026-08-29 recorded in docs/GAP-REGISTER.md). Everything the engine needs
 * to accept, route, and render one document type travels in ONE value:
 * the JSON Schema contract the engine compiles, the template metas +
 * their `DocNode` content, and the output rules that fire for it.
 *
 * Lives in RUNTIME, not `@busy-office/output-schema`: it composes
 * `OutputRule` (determination/rule-types.ts), which is a runtime concept,
 * and the schema package stays zero-runtime-dependency with no tenth
 * DocNode kind and no grammar change — this file only composes types that
 * already exist.
 *
 * Registration is explicit, process-local, synchronous, in-order, and
 * append-only: no unregister, no re-register, no hot-reload, no directory
 * scanning, no discovery by package name (all "must not build" under the
 * ruling). The composition root (`src/index.ts`) calls
 * `port.registerDocumentType(definition)` once per type at startup; a
 * host embedding the runtime does the same with its own definitions. The
 * engine (`src/**` minus `index.ts` and tests) never imports a document
 * type — `src/registration/engine-boundary.test.ts` enforces that.
 */
import type { DocNode, TemplateMeta } from '@busy-office/output-schema';
import type { OutputRule } from '../determination/rule-types.js';
import type { MessageTemplate } from '../message/message-template.js';

/** One template: its variant identity/lifecycle/renderer (`TemplateMeta`)
 * plus the frozen-nine-node `DocNode` tree the renderer consumes. Content
 * is never copied between templates — variant resolution + `parentId`
 * inheritance only (CLAUDE.md).
 *
 * `content` is optional so a meta-only variant (a `TemplateMeta` row with
 * no tree yet — `po-companyCode-1000-v1` on the built-in purchase order
 * is exactly this today) still registers as a determination CANDIDATE and
 * composes to the honest `'no-template-content'` outcome it always did,
 * instead of silently disappearing from variant resolution. Hosts that
 * always ship content simply never omit it. */
export interface RegisteredTemplate {
  meta: TemplateMeta;
  content?: DocNode;
}

export interface DocumentTypeDefinition {
  /** The `documentType` discriminator the data contract carries
   * (`DataContractEnvelope.documentType`), e.g. "purchase-order". Every
   * rule's `conditions.documentType` and every template's
   * `meta.variant.documentType` must equal it. */
  documentType: string;
  /**
   * The JSON Schema 2020-12 data contract for this document type, as a
   * plain object (`JSON.parse` of a `*.schema.json` file, typically). The
   * engine compiles it with ajv in strict mode plus the `x-pii` annotation
   * keyword (a tooling marker for payloads that must never be logged —
   * CLAUDE.md). A schema that references shared definitions must be
   * self-contained: embed the referenced schema resource (with its own
   * `$id`) under `$defs` so the compiler can resolve it without the engine
   * knowing where contract files live.
   */
  contract: object;
  templates: RegisteredTemplate[];
  rules: OutputRule[];
  /**
   * Channel message templates (GAP-10): the email subject/body for this
   * document type, per variant (locale, companyCode, ...), resolved by the
   * same most-specific-match rule as `templates`. Optional because a type
   * that only ever routes to `object-store` needs none; a type whose rule
   * resolves to `email` with no matching message template fails
   * determination loudly (`unresolved-message-template`). Same owner, same
   * lifecycle, same provenance as the document templates — see
   * `src/message/message-template.ts`.
   */
  messageTemplates?: MessageTemplate[];
}

/** One reason a definition was rejected. `path` is a human-readable
 * locator inside the definition (e.g. `rules[2].conditions.documentType`),
 * never payload data. */
export interface RegistrationProblem {
  path: string;
  message: string;
}

export type RegistrationResult =
  | { status: 'registered'; documentType: string; templateIds: string[]; messageTemplateIds: string[] }
  /** A definition with this `documentType` is already registered. Nothing
   * changed — there is no re-register or hot-reload in v1. */
  | { status: 'duplicate'; documentType: string }
  /** The definition was rejected in full (registration is atomic — a
   * partially-registered type never exists): the contract failed to
   * compile, a template id collides with one already registered (across
   * every document type), or a rule/template names a different
   * `documentType` than the definition does. */
  | { status: 'invalid'; documentType: string; problems: RegistrationProblem[] };
