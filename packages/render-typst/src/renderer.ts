/**
 * Path A Typst renderer (ADR-000 Option C hybrid, ADR-001 renderer-side
 * pagination — both Accepted). Shells out to `typst compile` — no npm
 * Typst binding — against a generated temp `.typ` file with all data
 * embedded as literals (emit-typst.ts). See emit-typst.ts's header comment
 * for the full overflow-guard design (the actual judgment call); this file
 * is where both guards are enforced and turned into a rejected promise —
 * Gate 4 requires overflow to FAIL the render, never silently succeed.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Artifact, Renderer, RenderJob } from '@busy-office/output-schema';
import { emitDocument, OVERFLOW_MARKER_LABEL } from './emit-typst.js';
import { countPdfPages } from './pdf-page-count.js';

/**
 * Guard 1 — fixed max-page cap. Typst has no built-in limit and will
 * happily paginate arbitrarily large input; a document that runs away in
 * page count from bad or unbounded data is also a Gate-4 concern (not the
 * classic "clipped" shape, but still content the caller did not intend and
 * should see as a failure, not a 4,000-page "success"). 60 is comfortably
 * above the largest legitimate corpus case (~10-20 pages for 120 lines)
 * and is intentionally NOT the mechanism relied on to catch a genuinely
 * clipped totals block — see Guard 2 and emit-typst.ts.
 */
export const DEFAULT_MAX_PAGES = 60;

export class TypstOverflowError extends Error {}
export class TypstCompileError extends Error {}

export interface TypstRendererOptions {
  /** Path/name of the typst binary (defaults to `typst` on PATH). */
  typstBin?: string;
  maxPages?: number;
}

interface MarkerValue {
  heightPt?: number;
  fullPageContentHeightPt?: number;
}

export class TypstRenderer implements Renderer {
  readonly id = 'typst';
  readonly version = '0.15.1'; // pinned typst CLI version this renderer was built/tested against
  readonly accepts: RenderJob['kind'][] = ['ir'];

  private readonly typstBin: string;
  private readonly maxPages: number;

  constructor(opts: TypstRendererOptions = {}) {
    this.typstBin = opts.typstBin ?? 'typst';
    this.maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  }

  async render(job: RenderJob): Promise<Artifact> {
    if (job.kind !== 'ir') {
      throw new Error(`TypstRenderer only accepts job kind 'ir', got '${job.kind}'`);
    }

    const { markup, fullPageContentHeightPt } = emitDocument(job.ir.root, job.ir.data);

    const dir = await mkdtemp(join(tmpdir(), 'bo-typst-'));
    const srcPath = join(dir, 'doc.typ');
    const pdfPath = join(dir, 'doc.pdf');
    try {
      await writeFile(srcPath, markup, 'utf8');

      const compile = await run(this.typstBin, ['compile', srcPath, pdfPath]);
      if (compile.code !== 0) {
        throw new TypstCompileError(`typst compile failed (exit ${compile.code}):\n${compile.stderr}`);
      }

      const markers = await this.queryOverflowMarkers(srcPath);

      // Guard 2 (see emit-typst.ts's header comment for the full story,
      // including the empirical proof that a position-marker approach does
      // NOT catch this for table content): the totals block's measured
      // natural height is compared to what a single, completely empty page
      // could ever hold. If it's taller than that, no page position could
      // save it from being silently clipped — this guard rejects before
      // that happens.
      for (const marker of markers) {
        if (
          typeof marker.heightPt === 'number' &&
          typeof marker.fullPageContentHeightPt === 'number' &&
          marker.heightPt > marker.fullPageContentHeightPt
        ) {
          throw new TypstOverflowError(
            `totals block cannot fit on any page: measured height ${marker.heightPt}pt exceeds the full single-page content height of ${marker.fullPageContentHeightPt}pt`,
          );
        }
      }

      const bytes = await readFile(pdfPath);

      // Guard 1 (see renderer.ts header comment): fixed max-page cap,
      // read straight off the compiled PDF bytes.
      const pageCount = countPdfPages(bytes);
      if (pageCount > this.maxPages) {
        throw new TypstOverflowError(`render exceeded max-page guard: ${pageCount} pages > cap of ${this.maxPages}`);
      }

      return { mediaType: 'application/pdf', bytes: new Uint8Array(bytes) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async queryOverflowMarkers(srcPath: string): Promise<MarkerValue[]> {
    const result = await run(this.typstBin, ['query', srcPath, `<${OVERFLOW_MARKER_LABEL}>`, '--field', 'value']);
    if (result.code !== 0) {
      throw new TypstCompileError(`typst query failed (exit ${result.code}):\n${result.stderr}`);
    }
    return parseQueryJson(result.stdout);
  }
}

/** `typst query` (deprecated but functional in 0.15.1) prints a JSON array on stdout, plus a deprecation warning on stderr. */
function parseQueryJson(stdout: string): MarkerValue[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  const parsed: unknown = JSON.parse(trimmed);
  return Array.isArray(parsed) ? (parsed as MarkerValue[]) : [];
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
