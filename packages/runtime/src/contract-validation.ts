/**
 * Contract compilation + validation: payloads are validated against
 * JSON Schema 2020-12 data
 * contracts — the schemas are the validation source of truth, not the
 * TypeScript aliases in @busy-office/output-schema (CLAUDE.md:
 * packages/schema stays zero-runtime-dependency; ajv lives here, in
 * packages/runtime, only).
 *
 * This module knows NO document type. It used to hardcode the list of
 * known types and read `packages/schema/contracts/*.schema.json` itself —
 * that hardcoded knowledge was the exact seam the engine's
 * document-type-blind registration boundary now closes.
 * Now a contract arrives as a plain schema object inside a
 * `DocumentTypeDefinition` (registration/document-type-definition.ts) and
 * is compiled here on registration; `src/registration/document-type-
 * registry.ts` holds the compiled validators keyed by documentType. The
 * engine-boundary test (registration/engine-boundary.test.ts) fails if any
 * engine file reaches for a contract file again.
 */
import { createRequire } from 'node:module';
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
  compile(schema: AnySchema): ValidateFunction;
  addKeyword(def: { keyword: string }): AjvInstance;
}

export type ContractValidationResult =
  | { valid: true }
  | { valid: false; errors: SchemaValidationError[] };

/** A compiled data contract: validates one payload at a time. */
export interface CompiledContract {
  validate(payload: unknown): ContractValidationResult;
}

export type ContractCompileResult =
  | { ok: true; contract: CompiledContract }
  /** `message` is ajv's own compile error (schema structure, unknown
   * keyword under strict mode, `$id` collision, unresolvable `$ref`) —
   * never payload data, since no payload exists at compile time. */
  | { ok: false; message: string };

export interface ContractCompiler {
  compile(schema: object): ContractCompileResult;
}

function toApiErrors(errors: ErrorObject[] | null | undefined): SchemaValidationError[] {
  return (errors ?? []).map((e) => ({
    instancePath: e.instancePath,
    schemaPath: e.schemaPath,
    keyword: e.keyword,
    message: e.message ?? 'validation failed',
  }));
}

/**
 * One ajv instance = one compiler: `$id`s are unique within it, so two
 * registrations of schemas that claim the same `$id` under different
 * document types collide loudly here (an `invalid` registration), instead
 * of the second silently reusing the first's compiled validator. Each
 * `DocumentTypeRegistry` owns exactly one compiler.
 *
 * Settings are the same the hardcoded validators always used: strict mode,
 * allErrors, ajv-formats (dates, currency patterns), and the `x-pii`
 * annotation registered as a no-op keyword so strict mode doesn't reject a
 * contract that carries CLAUDE.md's PII marker.
 */
export function createContractCompiler(): ContractCompiler {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-pii' });

  return {
    compile(schema: object): ContractCompileResult {
      let validate: ValidateFunction;
      try {
        validate = ajv.compile(schema as AnySchema);
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      return {
        ok: true,
        contract: {
          validate(payload: unknown): ContractValidationResult {
            const valid = validate(payload) as boolean;
            if (valid) return { valid: true };
            return { valid: false, errors: toApiErrors(validate.errors) };
          },
        },
      };
    },
  };
}
