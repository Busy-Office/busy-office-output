/**
 * Files-first rule + template-meta loading (ADR-003 Accepted Option 1):
 * rule files and template metas are diffable, reviewable, git-versioned
 * JSON, no DB. These two functions read a directory the CALLER names —
 * there is no default path and no module-level cache any more (GAP-08:
 * the engine knows no document type; registration into a
 * `DocumentTypeRegistry` is the cache). `packages/runtime/document-types/
 * *.ts` call them against `packages/runtime/rules/` and hand the result to
 * `OutputPort.registerDocumentType`; a host can point them at its own
 * directory or skip files entirely and build `OutputRule`s in code.
 *
 * Sorted by filename for a deterministic, reviewable evaluation order —
 * trace output (and first-match-wins tie-breaking) must not depend on
 * filesystem readdir order, which is not guaranteed stable across
 * platforms. A missing directory yields `[]`, not a throw.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { TemplateMeta } from '@busy-office/output-schema';
import type { OutputRule } from './rule-types.js';

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

/** Every `*.json` file directly under `dir`, parsed as an `OutputRule`, sorted by filename. */
export function loadRulesFromDir(dir: string): OutputRule[] {
  return readJsonFiles<OutputRule>(dir);
}

/** Every `*.json` file directly under `dir`, parsed as a `TemplateMeta`, sorted by filename. */
export function loadTemplateMetasFromDir(dir: string): TemplateMeta[] {
  return readJsonFiles<TemplateMeta>(dir);
}
