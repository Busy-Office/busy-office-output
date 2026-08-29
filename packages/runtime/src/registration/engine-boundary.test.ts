/**
 * Engine boundary lint (GAP-08, arb-chair ruling 2026-08-29): the engine
 * under `packages/runtime/src/` knows NO document type. Concretely, no
 * engine file may import `document-types/`, `rules/`, `contracts/`, or the
 * schema package's contracts path; the hardcoded `template-content.ts`
 * must not exist; and the `KNOWN_DOCUMENT_TYPES` list must not come back
 * under any name. Only the composition root (`src/index.ts`) and test
 * files are exempt — the root is WHERE registration happens, and tests
 * legitimately register the built-ins.
 *
 * A vitest test rather than ESLint / dependency-cruiser: the repo has no
 * ESLint, and a toolchain for one rule is gold-plating. This runs inside
 * `npm run verify` like every other test.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Forbidden import/require specifier patterns. */
const FORBIDDEN_SPECIFIERS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /document-types\//, why: 'document-types/ is registered by the composition root only' },
  { pattern: /(^|\/)rules\//, why: 'rule files are loaded by document-types/, never by the engine' },
  { pattern: /contracts\//, why: 'contract JSON is read by document-types/, never by the engine' },
  { pattern: /@busy-office\/output-schema\/contracts/, why: 'the schema package contracts path is a document-type source' },
];

/** Every `.ts` under `src/` except `*.test.ts` and `src/index.ts`. */
function engineFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...engineFiles(full));
      continue;
    }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    if (relative(SRC_DIR, full) === 'index.ts') continue;
    out.push(full);
  }
  return out;
}

/** Module specifiers from `import ... from '...'`, `export ... from '...'`,
 * `import('...')`, and `require('...')`. Regex, not a parser: the
 * specifiers this lint cares about are plain string literals. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

describe('engine boundary (GAP-08): src/** knows no document type', () => {
  const files = engineFiles(SRC_DIR);

  it('walks a non-trivial engine tree', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(`${sep}index.ts`) && relative(SRC_DIR, f) === 'index.ts')).toBe(false);
  });

  it('no engine file imports document-types/, rules/, contracts/, or the schema contracts path', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        for (const { pattern, why } of FORBIDDEN_SPECIFIERS) {
          if (pattern.test(specifier)) {
            violations.push(`${relative(SRC_DIR, file)} imports '${specifier}' — ${why}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('src/render/template-content.ts (the hardcoded template map) no longer exists', () => {
    expect(existsSync(join(SRC_DIR, 'render', 'template-content.ts'))).toBe(false);
  });

  it('KNOWN_DOCUMENT_TYPES occurs zero times under src/ (excluding this lint)', () => {
    const needle = ['KNOWN_', 'DOCUMENT_TYPES'].join(''); // keep this file itself clean of the literal
    const hits = engineFiles(SRC_DIR)
      .filter((f) => readFileSync(f, 'utf8').includes(needle))
      .map((f) => relative(SRC_DIR, f));
    expect(hits).toEqual([]);
    // index.ts is exempt from the import rule, not from this one.
    expect(readFileSync(join(SRC_DIR, 'index.ts'), 'utf8').includes(needle)).toBe(false);
  });
});
