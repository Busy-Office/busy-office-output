/**
 * Per-document-type retention policy (ROADMAP Stage 4, "Retention per doc
 * type enforced end-to-end"). Replaces composition.ts's old
 * `defaultRetentionUntil` — a single fixed 10-year default for every
 * document type, explicitly documented there as a Stage 3 stand-in.
 *
 * GAP-17: the per-type numbers are NOT in this file. Each document type's
 * OWNER supplies `retentionYears` on its `DocumentTypeDefinition`
 * (packages/runtime/document-types/{invoice,payslip,purchase-order}.ts for
 * the built-ins) and this policy reads them from the `DocumentTypeRegistry`;
 * the engine holds only the default. The rationale below for the three
 * built-in periods is kept here as the record of why those definitions
 * carry the numbers they do.
 *
 * NOT a real legal/regulatory decision (same caveat the Stage 3 stand-in
 * carried): these are plausible, commonly-cited orders of magnitude for
 * each document type, not a jurisdiction-specific compliance ruling. A
 * real deployment needs its own legal/tax sign-off per country before
 * these numbers can be trusted; what this module guarantees is that the
 * retention period genuinely *varies by document type* instead of being
 * one constant applied everywhere, which is what this task's DoD actually
 * requires.
 *
 *   - invoice: 10 years — commonly cited as a conservative ceiling for
 *     tax-relevant commercial-invoice retention in several VAT regimes
 *     (e.g. Germany's Aufbewahrungsfrist for invoices).
 *   - payslip: 6 years — commonly cited as a conservative ceiling for
 *     payroll-record retention (e.g. UK statutory minimums for wage
 *     records), while still being materially shorter than the invoice
 *     period, which is the whole point of this task ("payslip retention
 *     is not purchase-order retention" — HLD's own example).
 *   - purchase-order: 3 years — commercial correspondence / procurement
 *     records are frequently retained on a shorter horizon than
 *     tax-relevant invoices once the underlying transaction is closed.
 *   - anything else (unknown/future document types): 10 years — the same
 *     conservative fallback the old single default used, so a document
 *     type nobody has written an explicit policy for yet is never
 *     under-retained by accident; it just doesn't get the benefit of a
 *     shorter, type-specific period until someone adds one.
 */

import type { DocumentTypeRegistry } from '../registration/document-type-registry.js';

/** What the policy reads: the registry's owner-supplied retention years
 * (GAP-17). `Pick` so tests and hosts can hand in the narrowest thing. */
export type RetentionSource = Pick<DocumentTypeRegistry, 'retentionYears'>;

/** Fallback for any `documentType` whose definition supplies no
 * `retentionYears` (or that is not registered at all). */
export const DEFAULT_RETENTION_YEARS = 10;

/** The retention period, in years, for `documentType`: the registered
 * definition's `retentionYears`, else the conservative default. */
export function retentionYearsFor(documentTypes: RetentionSource, documentType: string): number {
  return documentTypes.retentionYears(documentType) ?? DEFAULT_RETENTION_YEARS;
}

/**
 * RFC 3339 `retentionUntil` for an artifact of `documentType`, archived at
 * `now` (defaults to the real current time). Injectable `now` so callers
 * (and their tests) can pin an exact value without depending on
 * wall-clock time — same pattern as `composition.ts`'s old
 * `defaultRetentionUntil`.
 */
export function retentionUntilFor(documentTypes: RetentionSource, documentType: string, now: Date = new Date()): string {
  const years = retentionYearsFor(documentTypes, documentType);
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}
