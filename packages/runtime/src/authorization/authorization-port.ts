/**
 * AuthorizationPort — document-level authorization for the three reprint
 * actions (reproduce/regenerate/reissue). First concrete shape for the
 * boundary concept ADR-007 names but does not define: "Host-side
 * integration points are interfaces (AuthorizationPort, storage
 * adapters), never imports of host internals." This module is that
 * interface plus a minimal default, fail-closed implementation — no host
 * import, no HTTP, no session/token concept.
 *
 * CLAUDE.md: "Authorization is evaluated against the DOCUMENT, not the
 * endpoint." `canAccess` takes the `DocumentRegistryRow` itself (not a
 * route, not a docId string a caller would have to re-fetch) — all three
 * reprint actions go through this one check regardless of which a caller
 * is attempting; the HTTP route wires an `Actor` from a proxy-asserted
 * identity, not a real session/token (see docs/GAP-REGISTER.md).
 *
 * Nothing here names a document type. Owner-scoping is read from
 * the `DocumentTypeRegistry` (`ownerIdPath`), which the type's owner
 * supplies through `DocumentTypeDefinition`.
 */
import type { DataContractEnvelope } from '@busy-office/output-schema';
import { evaluateExpression } from '@busy-office/render-typst';
import type { DocumentRegistryRow } from '../registry/registry-store.js';
import type { DocumentTypeRegistry } from '../registration/document-type-registry.js';

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

/** What the default port reads from the registry: whether a
 * document type is owner-scoped, i.e. its definition supplies an
 * `ownerIdPath`. `Pick` so tests can hand in the narrowest thing. */
export type OwnerScopeSource = Pick<DocumentTypeRegistry, 'ownerIdPath'>;

/**
 * Minimal default `AuthorizationPort`, built over
 * the document-type registry (the engine names no document type;
 * "is this type owner-scoped?" is a fact the type's OWNER supplies via
 * `DocumentTypeDefinition.ownerIdPath`):
 *  - an OWNER-SCOPED type (its definition supplies `ownerIdPath` — the
 *    built-in payslip does):
 *      - `role === 'hr-clerk'`: allowed.
 *      - `role === 'employee'`: allowed only when `actor.subjectId` equals
 *        the row's `ownerId` — the document's own natural-person owner,
 *        nobody else's.
 *      - anything else: DENIED (fail-closed — an owner-scoped type is one
 *        with a real access boundary to enforce, so the default-allow
 *        fallback deliberately does not cover it; that includes
 *        `role: 'employee'` with no `subjectId`).
 *  - every other type (purchase-order, invoice, memos, ...): a single
 *    coarse default-allow fallback. These have no natural-person owner to
 *    scope by (`ownerId` is populated only for owner-scoped mints) —
 *    per-type policy for them is explicitly out of scope (scope ruling
 *    item 3).
 */
export function createDefaultAuthorizationPort(documentTypes: OwnerScopeSource): AuthorizationPort {
  return {
    canAccess(actor: Actor, row: DocumentRegistryRow, _action: ReprintAction): boolean {
      if (documentTypes.ownerIdPath(row.documentType) !== undefined) {
        if (actor.role === 'hr-clerk') return true;
        if (actor.role === 'employee') return actor.subjectId !== undefined && actor.subjectId === row.ownerId;
        return false;
      }
      // Coarse default-allow fallback for every non-owner-scoped document
      // type — no natural-person owner to check against.
      return true;
    },
  };
}

/**
 * The `ownerId` to persist at mint time (scope ruling item 3): the value at
 * the type's registered `ownerIdPath` inside the validated envelope — for
 * the built-in payslip, `header.employeeId`
 * (packages/schema/contracts/payslip.schema.json: "Opaque internal
 * identifier, not a national ID — never a data element the runtime logs").
 * `undefined` when the type supplies no `ownerIdPath` (no natural-person
 * owner to record — see `createDefaultAuthorizationPort`'s coarse
 * fallback) or when the path resolves to anything but a string.
 *
 * Evaluated with render-typst's `evaluateExpression` — the SAME frozen
 * dot-path evaluator templates and message templates use; no
 * second path syntax. Deliberately defensive rather than trusting `data`'s
 * static type: called from the mint call site (`embed/create-output.ts`)
 * with an envelope that has already passed contract validation, but a
 * malformed or future-shaped payload just yields `undefined` (no owner
 * recorded) rather than throwing mid-mint.
 */
export function extractOwnerId(ownerIdPath: string | undefined, data: DataContractEnvelope): string | undefined {
  if (ownerIdPath === undefined) return undefined;
  const value = evaluateExpression(ownerIdPath, data);
  return typeof value === 'string' ? value : undefined;
}
