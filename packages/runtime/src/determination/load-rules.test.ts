import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRulesFromDir, loadTemplateMetasFromDir } from './load-rules.js';

/**
 * The loaders are document-type-blind and path-blind (GAP-08): they read
 * whatever directory the CALLER names, sorted by filename, with no default
 * path and no cache. The repo's real `packages/runtime/rules/` files are
 * exercised through `document-types/` (registration) — see
 * embed/output-port.contract.test.ts — not here.
 */
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'load-rules-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loadRulesFromDir / loadTemplateMetasFromDir (files-first, ADR-003)', () => {
  it('loads every *.json file under the named directory, sorted by filename, ignoring other files', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'b-second.json'), JSON.stringify({ id: 'second', conditions: { documentType: 'x' }, resolution: { channel: 'email' } }));
    writeFileSync(join(dir, 'a-first.json'), JSON.stringify({ id: 'first', conditions: { documentType: 'x' }, resolution: { channel: 'email' } }));
    writeFileSync(join(dir, 'README.md'), '# not a rule');
    expect(loadRulesFromDir(dir).map((r) => r.id)).toEqual(['first', 'second']);
  });

  it('loads template metas the same way', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'z.json'), JSON.stringify({ id: 'z-v1', variant: { documentType: 'x' }, version: '1.0.0', lifecycle: 'published', renderer: 'typst' }));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ id: 'a-v1', variant: { documentType: 'x' }, version: '1.0.0', lifecycle: 'published', renderer: 'typst' }));
    expect(loadTemplateMetasFromDir(dir).map((t) => t.id)).toEqual(['a-v1', 'z-v1']);
  });

  it('a missing directory yields [] rather than throwing', () => {
    expect(loadRulesFromDir(join(tempDir(), 'nope'))).toEqual([]);
    expect(loadTemplateMetasFromDir(join(tempDir(), 'nope'))).toEqual([]);
  });

  it('has no cache: a second call sees files written in between', () => {
    const dir = tempDir();
    expect(loadRulesFromDir(dir)).toEqual([]);
    writeFileSync(join(dir, 'r.json'), JSON.stringify({ id: 'r', conditions: { documentType: 'x' }, resolution: { channel: 'email' } }));
    expect(loadRulesFromDir(dir).map((r) => r.id)).toEqual(['r']);
  });
});
