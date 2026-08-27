/**
 * Files-first rule + template-candidate loading (ADR-003 Accepted Option 1).
 * Real rule files live in the repo at `packages/runtime/rules/output-rules/
 * *.json` and `packages/runtime/rules/templates/*.json` — diffable,
 * reviewable, git-versioned, no DB. Loaded once per process (module-level
 * cache) since these are deploy-time config, not runtime-mutable data; a
 * table-backed adapter is deferred per ADR-003, not built here.
 *
 * Sorted by filename for a deterministic, reviewable evaluation order —
 * trace output (and first-match-wins tie-breaking) must not depend on
 * filesystem readdir order, which is not guaranteed stable across
 * platforms.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TemplateMeta } from '@busy-office/output-schema';
import type { OutputRule } from './rule-types.js';

/**
 * Resolve packages/runtime/rules relative to this module's own location
 * (src/determination/ -> package root -> rules/), rather than
 * process.cwd(), so loading works the same under `npm test` from the repo
 * root and a standalone `serve()` run from any working directory.
 */
function rulesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', 'rules');
}

function readJsonFiles<T>(dir: string): T[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  fileNames.sort(); // deterministic evaluation order (see header comment)
  return fileNames.map((fileName) => JSON.parse(readFileSync(path.join(dir, fileName), 'utf8')) as T);
}

let cachedRules: OutputRule[] | undefined;
let cachedTemplates: TemplateMeta[] | undefined;

export function loadOutputRules(): OutputRule[] {
  if (cachedRules === undefined) {
    cachedRules = readJsonFiles<OutputRule>(path.join(rulesDir(), 'output-rules'));
  }
  return cachedRules;
}

export function loadTemplateCandidates(): TemplateMeta[] {
  if (cachedTemplates === undefined) {
    cachedTemplates = readJsonFiles<TemplateMeta>(path.join(rulesDir(), 'templates'));
  }
  return cachedTemplates;
}

/** Test-only escape hatch: force a reload on the next load* call. */
export function resetRuleCacheForTests(): void {
  cachedRules = undefined;
  cachedTemplates = undefined;
}
