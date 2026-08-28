/**
 * AuthorizationPort (ROADMAP Stage 4, "Document-level authorization:
 * reproduce/regenerate/reissue evaluated against the document" — DoD:
 * "HR-clerk vs employee test — same endpoint, different outcome"). First
 * concrete shape for the boundary concept ADR-007 names but does not
 * define: "Host-side integration points are interfaces (AuthorizationPort,
 * storage adapters), never imports of host internals." This module is that
 * interface plus a minimal default, fail-closed implementation — no host
 * import, no HTTP, no session/token concept.
 *
 * CLAUDE.md: "Authorization is evaluated against the DOCUMENT, not the
 * endpoint." `canAccess` takes the `DocumentRegistryRow` itself (not a
 * route, not a docId string a caller would have to re-fetch) — the same
 * three reprint actions (reproduce/regenerate/reissue) go through this one
 * check regardless of which of the three a caller is attempting; a live
 * HTTP route wiring an `Actor` from a real session/token is explicitly
 * Stage 5 (see this task's scope ruling) and does not exist yet —
 * `packages/runtime/src/console.ts`'s reprint trichotomy stays inert text,
 * unchanged by this module.
 */
import type { DataContractEnvelope } from '@busy-office/output-schema';
import type { DocumentRegistryRow } from '../registry/registry-store.js';

/** A plain, transport-agnostic caller identity. No token/session/JWT
 * concept — real authentication is a host/Stage-5 concern; this shape is
 * what `canAccess` needs to decide, nothing else. */
export interface Actor {
  role: string;
  /** The actor's own identity, compared against `DocumentRegistryRow.ownerId`
   * for the 'employee' role. Absent for roles that don't need it. */
  subjectId?: string;
}

/** The three reprint actions CLAUDE.md distinguishes: "reproduce = fetch
 * archive; regenerate = current template+data; reissue = new event." All
 * three are authorized identically by this port — which one a caller is
 * attempting does not change WHO may see the document, only what work is
 * done once they're allowed to. */
export type ReprintAction = 'reproduce' | 'regenerate' | 'reissue';

/** Host-side integration point (ADR-007): an interface, never an import of
 * host internals. A real host (e.g. busy-office-erp) supplies its own
 * implementation backed by its actual identity/entitlement system; this
 * module ships only the boundary shape plus one default, fail-closed
 * reference implementation. */
export interface AuthorizationPort {
  canAccess(actor: Actor, row: DocumentRegistryRow, action: ReprintAction): boolean;
}

/**
 * Minimal default `AuthorizationPort` (scope ruling, item 2):
 *  - `role === 'hr-clerk'`: allowed for `documentType === 'payslip'` rows.
 *  - `role === 'employee'`: allowed only when `actor.subjectId` equals the
 *    row's `ownerId` — the payslip's own employee, nobody else's.
 *  - every other document type (purchase-order, invoice, ...): a single
 *    coarse default-allow fallback. These document types have no
 *    natural-person owner to scope by (CLAUDE.md/schema: `ownerId` is
 *    populated only for payslip mints) — building per-type policy for them
 *    is explicitly out of scope for this task (scope ruling item 3).
 *
 * Fail-closed: any role/documentType combination not covered by the two
 * rules above falls through to the coarse default-allow ONLY for
 * non-payslip document types; an unrecognized role against a PAYSLIP row
 * (e.g. `role: 'employee'` with no `subjectId`, or any role other than
 * 'hr-clerk'/'employee') is denied — payslips are the one document type
 * with a real access boundary to enforce, so the default-allow fallback
 * deliberately does not cover them.
 */
export const defaultAuthorizationPort: AuthorizationPort = {
  canAccess(actor: Actor, row: DocumentRegistryRow, _action: ReprintAction): boolean {
    if (row.documentType === 'payslip') {
      if (actor.role === 'hr-clerk') return true;
      if (actor.role === 'employee') return actor.subjectId !== undefined && actor.subjectId === row.ownerId;
      return false;
    }
    // Coarse default-allow fallback for every other document type
    // (purchase-order, invoice, ...) — no natural-person owner to check
    // against; per-type policy for these is explicitly out of scope.
    return true;
  },
};

/**
 * The `ownerId` to persist at mint time (scope ruling item 3): the payslip
 * data contract's own `header.employeeId`
 * (packages/schema/contracts/payslip.schema.json: "Opaque internal
 * identifier, not a national ID — never a data element the runtime logs")
 * when `documentType === 'payslip'`; `undefined` for every other document
 * type, which have no natural-person owner to record (see
 * `defaultAuthorizationPort`'s coarse fallback above).
 *
 * Deliberately narrow and defensive rather than trusting `data`'s static
 * type: called from the mint call sites (`embed/create-output.ts`,
 * `server.ts`) with a `DataContractEnvelope` that has already passed
 * `validateContract`, but this function does not assume that — a
 * malformed or future-shaped payload just yields `undefined` (no owner
 * recorded) rather than throwing mid-mint.
 */
export function extractPayslipOwnerId(documentType: string, data: DataContractEnvelope): string | undefined {
  if (documentType !== 'payslip') return undefined;
  const header = data.header as { employeeId?: unknown } | undefined;
  return typeof header?.employeeId === 'string' ? header.employeeId : undefined;
}
