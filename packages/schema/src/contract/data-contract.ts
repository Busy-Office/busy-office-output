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

/**
 * Stage 1 document-type contracts (roadmap Stage 1, docs/STANDARDS.md Tier 1).
 * Source of truth is the JSON Schema in `packages/schema/contracts/`; these
 * aliases are compile-time ergonomics only, kept in sync by hand per the
 * rename-compatibility policy (`packages/schema/contracts/RENAME-POLICY.md`).
 */
export type CurrencyCode = string;   // ISO 4217, pattern-enforced in the JSON Schema
export type CountryCode = string;    // ISO 3166-1 alpha-2, pattern-enforced in the JSON Schema
export type UnitOfMeasureCode = string; // UNECE Rec 20, enum-enforced in the JSON Schema

export interface Money {
  currency: CurrencyCode;
  amount: number; // minor units (cents) — CLAUDE.md money convention
}

export interface PartyIdentification {
  scheme: string; // ISO 6523 ICD / Peppol EAS — reserved per ADR-006 Tier 1
  id: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  postalCode?: string;
  country: CountryCode;
}

export interface Party {
  name: string;
  address: Address;
  partyId?: PartyIdentification;
}

export const PURCHASE_ORDER_SCHEMA_VERSION = '1.0.0';
export interface PurchaseOrderData extends DataContractEnvelope<{
  poNumber: string;
  poDate: string;
  currency: CurrencyCode;
  buyer: Party;
  vendor: Party;
}> {
  documentType: 'purchase-order';
  schemaVersion: typeof PURCHASE_ORDER_SCHEMA_VERSION;
}

export const INVOICE_SCHEMA_VERSION = '1.0.0';
export interface InvoiceData extends DataContractEnvelope<{
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: CurrencyCode;
  seller: Party;
  buyer: Party;
  poReference?: string;
}> {
  documentType: 'invoice';
  schemaVersion: typeof INVOICE_SCHEMA_VERSION;
}

/** PII (CLAUDE.md): never log a PayslipData payload — hashes and rule traces only. */
export const PAYSLIP_SCHEMA_VERSION = '1.0.0';
export interface PayslipData extends DataContractEnvelope<{
  payslipNumber: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;
  currency: CurrencyCode;
  employer: Party;
  employeeId: string;
  employeeName: string;
}> {
  documentType: 'payslip';
  schemaVersion: typeof PAYSLIP_SCHEMA_VERSION;
}
