/**
 * `DocumentTypeRegistry` — the engine's ONLY source of document-type
 * knowledge (GAP-08 "registration inversion", arb-chair ruling 2026-08-29
 * in docs/GAP-REGISTER.md). It holds, per registered
 * `DocumentTypeDefinition`: the compiled contract validator, every
 * template's meta + `DocNode` content, and the output rules. Contract
 * validation (`emit`/`preview`), determination (`determine()`'s rule and
 * template-candidate inputs), and composition (`CompositionDeps.
 * documentTypes` → template content) all read from here and from nowhere
 * else. There is no default path, no directory scan, and no module-level
 * cache: registration IS the cache, and the composition root is what fills
 * it (src/index.ts registers `packages/runtime/document-types/` through
 * `OutputPort.registerDocumentType`).
 *
 * Registration is atomic: every check runs before any state changes, so
 * an `invalid` result leaves the registry exactly as it was. The contract
 * is compiled LAST, after every structural check, because ajv retains a
 * compiled schema's `$id` — compiling first and then rejecting on a
 * structural problem would leave a phantom `$id` behind that made the
 * caller's corrected retry fail on a collision with itself.
 *
 * Rule/template ORDER is registration order, then the order inside each
 * definition — deterministic, so `determine()`'s trace and its
 * file-order tie-break stay stable across runs.
 */
import type { DocNode, TemplateMeta } from '@busy-office/output-schema';
import { createContractCompiler, type CompiledContract, type ContractValidationResult } from '../contract-validation.js';
import type { OutputRule } from '../determination/rule-types.js';
import type { DocumentTypeDefinition, RegistrationProblem, RegistrationResult } from './document-type-definition.js';

export interface DocumentTypeRegistry {
  register(definition: DocumentTypeDefinition): RegistrationResult;
  /** True when a definition for `documentType` is registered. Accepts
   * `unknown` because ingress hands it whatever the payload carried. */
  has(documentType: unknown): documentType is string;
  /** Validate `payload` against the registered contract. Throws if
   * `documentType` is not registered — callers check `has()` first and
   * surface `unknown-document-type` themselves. */
  validate(documentType: string, payload: unknown): ContractValidationResult;
  /** Every registered rule, in registration order — `determine()`'s input. */
  rules(): readonly OutputRule[];
  /** Every registered template meta, in registration order — the variant
   * candidates `determine()` resolves against. */
  templateMetas(): readonly TemplateMeta[];
  templateMeta(templateId: string): TemplateMeta | undefined;
  /** The `DocNode` tree for `templateId`, or `undefined` if no registered
   * template has that id (composition reports `no-template-content`). */
  templateContent(templateId: string): DocNode | undefined;
  /** Registered document types, in registration order. */
  documentTypes(): readonly string[];
}

interface RegisteredType {
  contract: CompiledContract;
  templateIds: string[];
}

export function createDocumentTypeRegistry(): DocumentTypeRegistry {
  const compiler = createContractCompiler();
  const types = new Map<string, RegisteredType>();
  const templateMetas = new Map<string, TemplateMeta>();
  const templateContents = new Map<string, DocNode>();
  const rules: OutputRule[] = [];

  function checkStructure(definition: DocumentTypeDefinition): RegistrationProblem[] {
    const problems: RegistrationProblem[] = [];
    if (typeof definition.documentType !== 'string' || definition.documentType === '') {
      problems.push({ path: 'documentType', message: 'documentType must be a non-empty string' });
    }
    if (definition.contract === null || typeof definition.contract !== 'object') {
      problems.push({ path: 'contract', message: 'contract must be a JSON Schema object' });
    }
    const seenInThisDefinition = new Set<string>();
    definition.templates.forEach((template, i) => {
      const id = template.meta?.id;
      if (typeof id !== 'string' || id === '') {
        problems.push({ path: `templates[${i}].meta.id`, message: 'template id must be a non-empty string' });
        return;
      }
      if (templateMetas.has(id) || seenInThisDefinition.has(id)) {
        problems.push({ path: `templates[${i}].meta.id`, message: `template id "${id}" is already registered` });
      }
      seenInThisDefinition.add(id);
      if (template.meta.variant?.documentType !== definition.documentType) {
        problems.push({
          path: `templates[${i}].meta.variant.documentType`,
          message: `template "${id}" is for documentType "${String(template.meta.variant?.documentType)}", definition is "${definition.documentType}"`,
        });
      }
      if (template.content !== undefined && (template.content === null || typeof template.content !== 'object')) {
        problems.push({ path: `templates[${i}].content`, message: `template "${id}" content must be a DocNode object when present` });
      }
    });
    definition.rules.forEach((rule, i) => {
      if (rule.conditions?.documentType !== definition.documentType) {
        problems.push({
          path: `rules[${i}].conditions.documentType`,
          message: `rule "${String(rule.id)}" is for documentType "${String(rule.conditions?.documentType)}", definition is "${definition.documentType}"`,
        });
      }
    });
    return problems;
  }

  return {
    register(definition: DocumentTypeDefinition): RegistrationResult {
      const { documentType } = definition;
      if (types.has(documentType)) {
        return { status: 'duplicate', documentType };
      }
      const problems = checkStructure(definition);
      if (problems.length > 0) {
        return { status: 'invalid', documentType, problems };
      }
      // Compile last (see header): only a definition that passed every
      // structural check reaches ajv, so a rejected one leaves no `$id`.
      const compiled = compiler.compile(definition.contract);
      if (!compiled.ok) {
        return { status: 'invalid', documentType, problems: [{ path: 'contract', message: compiled.message }] };
      }

      const templateIds: string[] = [];
      for (const template of definition.templates) {
        templateMetas.set(template.meta.id, template.meta);
        if (template.content !== undefined) templateContents.set(template.meta.id, template.content);
        templateIds.push(template.meta.id);
      }
      rules.push(...definition.rules);
      types.set(documentType, { contract: compiled.contract, templateIds });
      return { status: 'registered', documentType, templateIds };
    },

    has(documentType: unknown): documentType is string {
      return typeof documentType === 'string' && types.has(documentType);
    },

    validate(documentType: string, payload: unknown): ContractValidationResult {
      const type = types.get(documentType);
      if (type === undefined) {
        throw new Error(`documentType "${documentType}" is not registered — check has() before validate().`);
      }
      return type.contract.validate(payload);
    },

    rules(): readonly OutputRule[] {
      return rules;
    },
    templateMetas(): readonly TemplateMeta[] {
      return [...templateMetas.values()];
    },
    templateMeta(templateId: string): TemplateMeta | undefined {
      return templateMetas.get(templateId);
    },
    templateContent(templateId: string): DocNode | undefined {
      return templateContents.get(templateId);
    },
    documentTypes(): readonly string[] {
      return [...types.keys()];
    },
  };
}
