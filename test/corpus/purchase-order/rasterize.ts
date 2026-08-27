/**
 * Rasterizes a corpus purchase-order render to PNG (ROADMAP Stage 2:
 * "rasterize the corpus PO" step for the template-from-sample round-trip
 * proof). Shells out to `typst compile --format png` directly against the
 * emitted markup (emit-typst.ts) — `TypstRenderer` itself only exposes
 * compiled PDF bytes, not the intermediate `.typ` source, so this
 * re-emits markup independently via the same `emitDocument` the renderer
 * uses, rather than reaching into renderer.ts's private temp dir.
 *
 * Single-page corpus cases only (no `{p}` page-number template needed —
 * see `typst compile --help`); multi-page rasterization would need one
 * output path per page and is out of scope for the round-trip proof this
 * feeds (which uses `001-single-page`).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { emitDocument } from '@busy-office/render-typst';
import type { DocNode, PurchaseOrderData } from '@busy-office/output-schema';

export interface RasterizeOptions {
  typstBin?: string;
  ppi?: number;
}

/** Compiles `root` bound against `data` straight to a single PNG page. Returns the raw PNG bytes. */
export async function rasterizeToPng(root: DocNode, data: PurchaseOrderData, opts: RasterizeOptions = {}): Promise<Uint8Array> {
  const typstBin = opts.typstBin ?? 'typst';
  const ppi = opts.ppi ?? 144;
  const { markup } = emitDocument(root, data);

  const dir = await mkdtemp(join(tmpdir(), 'bo-typst-png-'));
  const srcPath = join(dir, 'doc.typ');
  const pngPath = join(dir, 'doc.png');
  try {
    await writeFile(srcPath, markup, 'utf8');
    const result = await run(typstBin, ['compile', '--format', 'png', '--ppi', String(ppi), srcPath, pngPath]);
    if (result.code !== 0) {
      throw new Error(`typst compile --format png failed (exit ${result.code}):\n${result.stderr}`);
    }
    return new Uint8Array(await readFile(pngPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface RunResult {
  code: number;
  stderr: string;
}

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}
