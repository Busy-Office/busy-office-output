/**
 * Shared file readers for the built-in document types in this directory.
 * This directory sits OUTSIDE `src/` on purpose (GAP-08, arb-chair ruling
 * 2026-08-29): the engine under `src/` knows no document type, and
 * `src/registration/engine-boundary.test.ts` fails if any engine file
 * imports `document-types/`, `rules/`, or `contracts/`. Only the
 * composition root (`src/index.ts`) imports `./index.js` and registers
 * each definition through `OutputPort.registerDocumentType`.
 *
 * Contract JSON stays in `packages/schema/contracts/` (moving it would
 * touch RENAME-POLICY.md for no gain). The three built-in contracts `$ref`
 * `common.schema.json#/$defs/...` by relative URI; a `DocumentTypeDefinition`
 * carries ONE self-contained schema object, so `readContract` embeds the
 * shared `common.schema.json` resource (with its own `$id`) under the
 * contract's `$defs` — ajv resolves the relative `$ref`s against that
 * embedded `$id` exactly as it used to against a separately-added schema.
 * The contract's own validation rules are byte-for-byte the file's.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocNode, TemplateMeta } from '@busy-office/output-schema';
import { loadRulesFromDir, loadTemplateMetasFromDir, type OutputRule } from '../src/determination/index.js';
import type { RegisteredTemplate } from '../src/registration/document-type-definition.js';

const require = createRequire(import.meta.url);

/**
 * Resolve packages/schema/contracts without hardcoding a relative path
 * across the two sibling packages — walk up from @busy-office/output-schema's
 * own package.json, which is robust to the workspace layout (npm workspaces
 * symlink or plain sibling directories alike). `require.resolve` rather
 * than `import.meta.resolve`: the latter isn't implemented by Vitest's
 * Vite-SSR module loader, and this must work identically under `npm test`
 * and a plain Node run.
 */
function contractsDir(): string {
  const schemaPackageJson = require.resolve('@busy-office/output-schema/package.json');
  return path.join(path.dirname(schemaPackageJson), 'contracts');
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

/** `packages/schema/contracts/<fileName>` with `common.schema.json` embedded under `$defs.common`. */
export function readContract(fileName: string): object {
  const dir = contractsDir();
  const contract = readJson(path.join(dir, fileName));
  const common = readJson(path.join(dir, 'common.schema.json'));
  const defs = (contract.$defs as Record<string, unknown> | undefined) ?? {};
  return { ...contract, $defs: { ...defs, common } };
}

/** `packages/runtime/rules` resolved relative to this file, not process.cwd(). */
function rulesRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rules');
}

/** Every rule file under `rules/output-rules/` whose `conditions.documentType` is `documentType`, filename order. */
export function rulesFor(documentType: string): OutputRule[] {
  return loadRulesFromDir(path.join(rulesRoot(), 'output-rules')).filter((r) => r.conditions.documentType === documentType);
}

/** Every template meta under `rules/templates/` whose `variant.documentType` is `documentType`, filename order. */
export function templateMetasFor(documentType: string): TemplateMeta[] {
  return loadTemplateMetasFromDir(path.join(rulesRoot(), 'templates')).filter((t) => t.variant.documentType === documentType);
}

/**
 * Every meta on disk for `documentType`, paired with its `DocNode` tree
 * where one is wired. A meta with no entry in `contents` registers
 * meta-only: it stays a determination candidate (variant resolution is
 * unchanged) and composes to the honest `'no-template-content'` outcome,
 * exactly as it did before the move out of `src/`. A content id with no
 * meta on disk is a wiring bug in THIS directory and throws at import.
 */
export function templatesFor(documentType: string, contents: Readonly<Record<string, DocNode>>): RegisteredTemplate[] {
  const metas = templateMetasFor(documentType);
  for (const id of Object.keys(contents)) {
    if (!metas.some((m) => m.id === id)) {
      throw new Error(`document-types/${documentType}: content wired for "${id}" but no template meta with that id exists under rules/templates/`);
    }
  }
  return metas.map((meta) => {
    const content = contents[meta.id];
    return content === undefined ? { meta } : { meta, content };
  });
}
