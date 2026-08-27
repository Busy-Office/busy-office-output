/**
 * Structural diff between two rendered PDFs (ROADMAP Stage 2 / ADR-005
 * verifier). Reports page-count delta plus per-page word add/remove/move —
 * never a pixel diff. This is what `bo-output diff` (../cli/diff.ts) and
 * the ADR-005 AI-template corpus-diff gate both consume.
 *
 * Text/box source: pdf-words.ts (`pdftotext -bbox-layout`). Word matching:
 * a plain LCS diff over the page's word sequence (reading order, as
 * pdftotext already emits it) — the same algorithm behind line-based text
 * diff tools, applied to words instead of lines. A second pass pairs up
 * leftover deletions/insertions that share exact text (closest by
 * Euclidean distance) and reports them as "moved" instead of a
 * delete+insert pair, which is what makes e.g. a totals row shifting pages
 * read as one line instead of noise.
 */
import { countPdfPages } from '../pdf-page-count.js';
import { extractPdfWords, type ExtractWordsOptions, type Word } from './pdf-words.js';

export interface Point {
  x: number;
  y: number;
}

export type WordDiffOp =
  | { kind: 'add'; text: string; to: Point }
  | { kind: 'del'; text: string; from: Point }
  | { kind: 'move'; text: string; from: Point; to: Point };

export interface PageDiff {
  /** 1-based page number, for human-readable output. */
  page: number;
  ops: WordDiffOp[];
}

export interface StructuralDiff {
  pageCountA: number;
  pageCountB: number;
  pageCountDelta: number;
  pages: PageDiff[];
  /** True only when page counts match and no page has any word-level op. */
  identical: boolean;
}

/** Position delta (pt) below which a same-text word is treated as unchanged rather than "moved". */
const MOVE_EPSILON_PT = 1.0;

export async function diffPdfBytes(a: Uint8Array, b: Uint8Array, opts: ExtractWordsOptions = {}): Promise<StructuralDiff> {
  const pageCountA = countPdfPages(a);
  const pageCountB = countPdfPages(b);
  const [wordsA, wordsB] = await Promise.all([extractPdfWords(a, opts), extractPdfWords(b, opts)]);

  const maxPages = Math.max(wordsA.length, wordsB.length);
  const pages: PageDiff[] = [];
  for (let i = 0; i < maxPages; i++) {
    const pa = wordsA[i]?.words ?? [];
    const pb = wordsB[i]?.words ?? [];
    const ops = diffPageWords(pa, pb);
    if (ops.length > 0) pages.push({ page: i + 1, ops });
  }

  return {
    pageCountA,
    pageCountB,
    pageCountDelta: pageCountB - pageCountA,
    pages,
    identical: pageCountA === pageCountB && pages.length === 0,
  };
}

function diffPageWords(a: Word[], b: Word[]): WordDiffOp[] {
  const rawOps = lcsDiff(
    a.map((w) => w.text),
    b.map((w) => w.text),
  );

  const dels: Word[] = [];
  const adds: Word[] = [];
  for (const op of rawOps) {
    if (op.type === 'del') dels.push(a[op.aIndex]);
    else if (op.type === 'add') adds.push(b[op.bIndex]);
  }

  const ops: WordDiffOp[] = [];
  const usedAdds = new Set<number>();

  for (const d of dels) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let j = 0; j < adds.length; j++) {
      if (usedAdds.has(j) || adds[j].text !== d.text) continue;
      const dist = Math.hypot(adds[j].x - d.x, adds[j].y - d.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      usedAdds.add(bestIdx);
      if (bestDist > MOVE_EPSILON_PT) {
        const add = adds[bestIdx];
        ops.push({ kind: 'move', text: d.text, from: { x: d.x, y: d.y }, to: { x: add.x, y: add.y } });
      }
      // else: same text, negligible position delta — LCS-alignment artifact, not a real change.
    } else {
      ops.push({ kind: 'del', text: d.text, from: { x: d.x, y: d.y } });
    }
  }

  for (let j = 0; j < adds.length; j++) {
    if (!usedAdds.has(j)) ops.push({ kind: 'add', text: adds[j].text, to: { x: adds[j].x, y: adds[j].y } });
  }

  return ops;
}

type LcsOp = { type: 'same'; aIndex: number; bIndex: number } | { type: 'del'; aIndex: number } | { type: 'add'; bIndex: number };

/** Classic LCS-backtrace diff (same algorithm shape as line-based `diff`), applied to word tokens. */
function lcsDiff(a: string[], b: string[]): LcsOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: LcsOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', aIndex: i, bIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', aIndex: i });
      i++;
    } else {
      ops.push({ type: 'add', bIndex: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', aIndex: i });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', bIndex: j });
    j++;
  }
  return ops;
}

/** Renders a `StructuralDiff` as the human-readable report a maintainer reads in CI. */
export function formatStructuralDiff(diff: StructuralDiff): string {
  const lines: string[] = [];
  const sign = diff.pageCountDelta >= 0 ? '+' : '';
  lines.push(`Page count: ${diff.pageCountA} -> ${diff.pageCountB} (${sign}${diff.pageCountDelta})`);

  if (diff.pages.length === 0) {
    lines.push(diff.identical ? 'No structural differences.' : 'No per-page text/box differences (page count changed only).');
    return lines.join('\n');
  }

  for (const page of diff.pages) {
    lines.push(`Page ${page.page}:`);
    for (const op of page.ops) {
      if (op.kind === 'add') {
        lines.push(`  + "${op.text}" at (${fmt(op.to.x)}, ${fmt(op.to.y)})`);
      } else if (op.kind === 'del') {
        lines.push(`  - "${op.text}" at (${fmt(op.from.x)}, ${fmt(op.from.y)})`);
      } else {
        lines.push(`  ~ "${op.text}" moved (${fmt(op.from.x)}, ${fmt(op.from.y)}) -> (${fmt(op.to.x)}, ${fmt(op.to.y)})`);
      }
    }
  }
  return lines.join('\n');
}

function fmt(n: number): string {
  return n.toFixed(1);
}
