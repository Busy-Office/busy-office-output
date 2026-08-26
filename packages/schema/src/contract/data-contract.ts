/**
 * The versioned boundary between the ERP and this system (HLD §3).
 * SURVIVES BOTH ADR-000 PATHS: Carbone templates and schema templates
 * consume the same payload shape.
 */
export interface DataContractEnvelope<T = unknown> {
  schemaVersion: string;        // semver of the documentType's contract
  documentType: string;         // e.g. "purchase-order"
  header: T;                    // documentType-specific
  lines?: unknown[];
  totals?: Record<string, number>;
}

/** Idempotency identity (HLD §9): a replayed event must return the existing docId. */
export interface BusinessEventKey {
  businessObject: string;       // e.g. "EKKO"
  businessObjectId: string;     // e.g. "4500001234"
  event: string;                // e.g. "po.released"
  templateVersion: string;
}
