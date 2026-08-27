/**
 * `npm run diff -- <a> <b>` — the ROADMAP Stage 2 structural diff CLI. Same
 * tool doubles as the ADR-005 AI-template-verifier (no verifier, no
 * generation): a template change is only trustworthy once this diff has
 * been read.
 *
 * Each argument is either:
 *  - a `.pdf` file, read as-is, or
 *  - a `.json` file containing a `LayoutIR` (`{ irVersion, root, data }`),
 *    rendered through `TypstRenderer` first.
 *
 * Exit codes follow the Unix `diff` convention: 0 = identical, 1 = an
 * intentional-or-not structural difference was found (read the report),
 * 2 = usage/tooling error (bad args, `typst`/`pdftotext` missing, etc.).
 *
 * Run via `tsx` (root devDependency), not plain `node`: this repo's `.ts`
 * sources use NodeNext-style `.js`-suffixed relative imports so `tsc`
 * resolves them, but plain Node's native TypeScript support does not
 * rewrite `.js` specifiers to the sibling `.ts` file the way `tsc`/`tsx` do
 * — `node src/cli/diff.ts` fails with ERR_MODULE_NOT_FOUND. `npm run diff`
 * wraps this correctly; see root package.json.
 */
import { readFile } from 'node:fs/promises';
import type { LayoutIR } from '@busy-office/output-schema';
import { TypstRenderer } from '../renderer.js';
import { diffPdfBytes, formatStructuralDiff } from '../diff/structural-diff.js';

async function loadPdfBytes(pathArg: string, renderer: TypstRenderer): Promise<Uint8Array> {
  if (pathArg.endsWith('.pdf')) {
    return new Uint8Array(await readFile(pathArg));
  }
  if (pathArg.endsWith('.json')) {
    const raw = await readFile(pathArg, 'utf8');
    const ir = JSON.parse(raw) as LayoutIR;
    const artifact = await renderer.render({ kind: 'ir', ir });
    return artifact.bytes;
  }
  throw new Error(`Unrecognized input '${pathArg}': expected a .pdf file, or a .json file containing a LayoutIR ({ irVersion, root, data }).`);
}

export async function runDiffCli(argv: string[]): Promise<number> {
  const [a, b] = argv;
  if (!a || !b) {
    console.error('Usage: bo-output diff <a.pdf|a.json> <b.pdf|b.json>');
    return 2;
  }

  const renderer = new TypstRenderer();
  const [bytesA, bytesB] = await Promise.all([loadPdfBytes(a, renderer), loadPdfBytes(b, renderer)]);
  const diff = await diffPdfBytes(bytesA, bytesB);
  console.log(formatStructuralDiff(diff));
  return diff.identical ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runDiffCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    });
}
