/**
 * Word-level text + position extraction from rendered PDF bytes, for
 * structural-diff.ts's page-count + box/text delta comparison (never
 * pixels).
 *
 * Deliberately NOT a from-scratch PDF content-stream parser: Typst's PDF
 * output uses compressed content streams, and writing a Flate-aware
 * text-extraction layer here would duplicate a well-tested tool for no
 * benefit. Shells out to `pdftotext -bbox-layout` (poppler-utils) the same
 * way renderer.ts shells out to `typst` — an external CLI dependency, not
 * an npm package, consistent with this repo's existing pattern of pinning
 * binaries rather than vendoring parsers. `-bbox-layout` emits one XHTML
 * document with a `<word xMin=".." yMin=".." xMax=".." yMax="..">text</word>`
 * per detected word, grouped by `<page>` — exactly the box+text shape this
 * diff needs, already in reading order.
 *
 * `pdftotext` (poppler-utils) is pinned alongside `typst`/`verapdf` in the
 * `Dockerfile` and `.github/ci/install-tools.sh`.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Word {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageWords {
  pageIndex: number;
  width: number;
  height: number;
  words: Word[];
}

export class PdfTextExtractionError extends Error {}

export interface ExtractWordsOptions {
  /** Path/name of the pdftotext binary (defaults to `pdftotext` on PATH). */
  pdftotextBin?: string;
}

/** Runs `pdftotext -bbox-layout` against `pdfBytes` and returns per-page word boxes in reading order. */
export async function extractPdfWords(pdfBytes: Uint8Array, opts: ExtractWordsOptions = {}): Promise<PageWords[]> {
  const bin = opts.pdftotextBin ?? 'pdftotext';
  const dir = await mkdtemp(join(tmpdir(), 'bo-pdftotext-'));
  const pdfPath = join(dir, 'in.pdf');
  try {
    await writeFile(pdfPath, pdfBytes);
    const result = await run(bin, ['-bbox-layout', pdfPath, '-']);
    if (result.code !== 0) {
      throw new PdfTextExtractionError(
        `pdftotext failed (exit ${result.code}) — is poppler-utils installed?\n${result.stderr}`,
      );
    }
    return parseBboxXhtml(result.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const PAGE_RE = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
const WORD_RE = /<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)">([^<]*)<\/word>/g;

function parseBboxXhtml(xhtml: string): PageWords[] {
  const pages: PageWords[] = [];
  let pageIndex = 0;
  PAGE_RE.lastIndex = 0;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = PAGE_RE.exec(xhtml))) {
    const width = Number(pageMatch[1]);
    const height = Number(pageMatch[2]);
    const body = pageMatch[3];
    const words: Word[] = [];
    WORD_RE.lastIndex = 0;
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = WORD_RE.exec(body))) {
      const xMin = Number(wordMatch[1]);
      const yMin = Number(wordMatch[2]);
      const xMax = Number(wordMatch[3]);
      const yMax = Number(wordMatch[4]);
      words.push({
        text: decodeXmlEntities(wordMatch[5]),
        x: xMin,
        y: yMin,
        w: xMax - xMin,
        h: yMax - yMin,
      });
    }
    pages.push({ pageIndex, width, height, words });
    pageIndex++;
  }
  return pages;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
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
