/**
 * Contract validation (ROADMAP Stage 3 task 1): validates an ingress payload
 * against the JSON Schema contracts in packages/schema/contracts/ — those
 * schemas are the validation source of truth, not the TypeScript aliases in
 * @busy-office/output-schema (CLAUDE.md: packages/schema stays
 * zero-runtime-dependency; ajv lives here, in packages/runtime, only).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import type { SchemaValidationError } from './problem.js';

// ajv and ajv-formats are CJS-only and their .d.ts default-export shape does
// not interop cleanly with `moduleResolution: nodenext` + `strict` without
// esModuleInterop (a known ajv/TS friction point) — load them via require()
// so the (well-understood, narrow) runtime values are untyped rather than
// fighting the type checker over an ESM/CJS default-export mismatch. Types
// for what they return (Ajv2020 instance, ValidateFunction, ErrorObject,
// AnySchema) still come from ajv's own `.d.ts` via `import type` above.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Ajv2020 } = require('ajv/dist/2020.js') as { Ajv2020: new (opts?: unknown) => AjvInstance };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const addFormatsModule = require('ajv-formats');
const addFormats = (addFormatsModule.default ?? addFormatsModule) as (ajv: AjvInstance) => void;

interface AjvInstance {
  addSchema(schema: AnySchema): AjvInstance;
  compile(schema: AnySchema): ValidateFunction;
}

export const KNOWN_DOCUMENT_TYPES = ['purchase-order', 'invoice', 'payslip'] as const;
export type DocumentType = (typeof KNOWN_DOCUMENT_TYPES)[number];

export function isKnownDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (KNOWN_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Resolve packages/schema/contracts without hardcoding a relative path
 * across the two sibling packages — walk up from @busy-office/output-schema's
 * own package.json, which is robust to the workspace layout (npm workspaces
 * symlink or plain sibling directories alike).
 */
function contractsDir(): string {
  // require.resolve (via createRequire) rather than import.meta.resolve:
  // the latter isn't implemented by Vitest's Vite-SSR module loader, and
  // this needs to work identically under `npm test` and a plain Node run.
  const schemaPackageJson = require.resolve('@busy-office/output-schema/package.json');
  return path.join(path.dirname(schemaPackageJson), 'contracts');
}

function loadContractSchema(fileName: string): AnySchema {
  const filePath = path.join(contractsDir(), fileName);
  return JSON.parse(readFileSync(filePath, 'utf8')) as AnySchema;
}

function buildAjv(): AjvInstance {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  // payslip.schema.json carries a top-level "x-pii": true annotation
  // (CLAUDE.md: payslips are PII) — a tooling marker, not a validation
  // keyword; register it as a no-op so ajv strict mode doesn't reject it.
  (ajv as unknown as { addKeyword(def: { keyword: string }): void }).addKeyword({ keyword: 'x-pii' });
  // common.schema.json is $ref'd by relative URI ("common.schema.json#/$defs/...")
  // from each document-type schema; registering it lets ajv resolve those refs.
  ajv.addSchema(loadContractSchema('common.schema.json'));
  return ajv;
}

const ajv = buildAjv();

const validators: Record<DocumentType, ValidateFunction> = {
  'purchase-order': ajv.compile(loadContractSchema('purchase-order.schema.json')),
  invoice: ajv.compile(loadContractSchema('invoice.schema.json')),
  payslip: ajv.compile(loadContractSchema('payslip.schema.json')),
};

function toApiErrors(errors: ErrorObject[] | null | undefined): SchemaValidationError[] {
  return (errors ?? []).map((e) => ({
    instancePath: e.instancePath,
    schemaPath: e.schemaPath,
    keyword: e.keyword,
    message: e.message ?? 'validation failed',
  }));
}

export type ContractValidationResult =
  | { valid: true }
  | { valid: false; errors: SchemaValidationError[] };

/** Validate `payload` against the JSON Schema contract for `documentType`. */
export function validateContract(documentType: DocumentType, payload: unknown): ContractValidationResult {
  const validate = validators[documentType];
  const valid = validate(payload) as boolean;
  if (valid) return { valid: true };
  return { valid: false, errors: toApiErrors(validate.errors) };
}
