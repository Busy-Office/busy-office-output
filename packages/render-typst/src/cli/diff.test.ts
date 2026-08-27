import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { LayoutIR } from '@busy-office/output-schema';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function irFor(title: string): LayoutIR {
  return {
    irVersion: '1.0.0',
    root: {
      kind: 'document',
      page: { size: 'A4', margin: [40, 40, 40, 40] },
      children: [{ kind: 'text', value: 'header.title' }],
    },
    data: { schemaVersion: '1.0.0', documentType: 'diff-fixture', header: { title } },
  };
}

async function writeIrFile(dir: string, name: string, title: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(irFor(title)), 'utf8');
  return path;
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'packages/render-typst/src/cli/diff.ts', ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe('bo-output diff CLI', () => {
  it('renders two LayoutIR .json inputs, exits 1 on a real diff, and prints a readable report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bo-diff-cli-'));
    const a = await writeIrFile(dir, 'a.json', 'Hello World');
    const b = await writeIrFile(dir, 'b.json', 'Hello Universe');

    const result = await runCli([a, b]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Page count: 1 -> 1 (+0)');
    expect(result.stdout).toContain('- "World"');
    expect(result.stdout).toContain('+ "Universe"');
  }, 30000);

  it('exits 0 with "No structural differences" for identical inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bo-diff-cli-'));
    const a = await writeIrFile(dir, 'a.json', 'Same Text');
    const b = await writeIrFile(dir, 'b.json', 'Same Text');

    const result = await runCli([a, b]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No structural differences.');
  }, 30000);
});
