/**
 * Composition for the pdf-direct path: walks the same bound `DocNode` tree
 * (packages/schema/src/document/nodes.ts, frozen nine kinds) the Typst
 * renderer consumes and turns it into positioned draw ops on ONE page.
 * This is the one job pdf-lib does not do for you — measuring text with
 * the embedded font's real metrics, greedy word-wrap, stacking boxes —
 * and it is exactly what the Stage 0 spike prototyped (docs/RESULTS.md;
 * `git show 526b038:spike/pdf-direct/run.js`). Deliberately limited to
 * what a single-page, simple document needs (ADR-002 routing rule): there
 * is no pagination here at all, by design, not by omission.
 *
 * Gate 4 (spike/README.md's five gates, HLD §9): overflow FAILS. The
 * layout pass is pure measurement — nothing is painted until every block
 * has been placed and proven to fit above the bottom margin — so a
 * document that does not fit throws `PdfDirectOverflowError` before a
 * single byte of PDF exists. There is no code path that clips.
 *
 * Routing-rule enforcement (ADR-001/ADR-002): a table with `carryForward`
 * and any text outside the Latin range (latin.ts) are refused with
 * `PdfDirectUnsupportedError`. Both are Typst's by decision; rendering
 * them "somehow" here would either silently drop the carried-forward
 * semantics or paint .notdef boxes — each a Gate-4-shaped silent failure.
 *
 * Conventions copied from packages/render-typst/src/emit-typst.ts so the
 * two renderers read a template the same way (its header comment records
 * them as judgment calls; they are not re-decided here):
 *  - `document.page.margin` is `[top, right, bottom, left]` in points.
 *  - a top-level `header` is in-flow page-1 content; a top-level `footer`
 *    is a page footer (only `pageNumber` is meaningful there).
 *  - 9 pt body text, 16 pt bold title, table stroke 0.4 pt gray, inset 3 pt.
 *  - money: a numeric cell whose key ends in `.amount` is cents and is
 *    formatted by render-typst's `formatMoneyCents` (shared, not copied).
 */
import type { DataContractEnvelope, DocNode, TableColumn } from '@busy-office/output-schema';
import { evaluateExpression, evaluateRelative, formatMoneyCents, isMoneyAmountPath } from '@busy-office/render-typst';
import { firstNonLatinCodePoint } from './latin.js';

export class PdfDirectOverflowError extends Error {}
export class PdfDirectUnsupportedError extends Error {}

const PAPER_PT: Record<'A4' | 'Letter', { width: number; height: number }> = {
  A4: { width: 595.2756, height: 841.8898 },
  Letter: { width: 612, height: 792 },
};

const BODY_SIZE = 9;
const BODY_LINE = 12;
const TITLE_SIZE = 16;
const TITLE_LINE = 20;
const BLOCK_GAP = 10;
const CELL_INSET = 3;
const GRID_COLUMN_GUTTER = 10;
const GRID_ROW_GUTTER = 4;
const STROKE = 0.4;

/** Text metrics + glyph coverage for the two embedded faces. Supplied by the renderer, so this file never touches pdf-lib. */
export interface FontMetrics {
  widthOf(text: string, size: number, bold: boolean): number;
  hasGlyph(codePoint: number, bold: boolean): boolean;
}

export type DrawOp =
  | { op: 'text'; text: string; x: number; y: number; size: number; bold: boolean }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; thickness: number; gray: number };

export interface PageLayout {
  widthPt: number;
  heightPt: number;
  ops: DrawOp[];
}

interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
  contentWidth: number;
  /** Current baseline-top cursor (moves downward). */
  y: number;
}

export function layoutDocument(root: DocNode, data: DataContractEnvelope, fonts: FontMetrics): PageLayout {
  if (root.kind !== 'document') {
    throw new Error(`LayoutIR.root must be kind 'document', got '${root.kind}'`);
  }
  const paper = PAPER_PT[root.page.size];
  const [top, right, bottom, left] = root.page.margin;
  const frame: Frame = {
    left,
    right: paper.width - right,
    top: paper.height - top,
    bottom,
    contentWidth: paper.width - left - right,
    y: paper.height - top,
  };
  const ops: DrawOp[] = [];
  const ctx: Ctx = { data, fonts, frame, ops, paper };

  const footer = root.children.find((c) => c.kind === 'footer');
  const body = root.children.filter((c) => c.kind !== 'footer');

  let first = true;
  for (const child of body) {
    if (!first) frame.y -= BLOCK_GAP;
    first = false;
    layoutNode(ctx, child);
  }

  if (footer !== undefined && footer.kind === 'footer') {
    layoutPageFooter(ctx, footer.children);
  }

  return { widthPt: paper.width, heightPt: paper.height, ops };
}

interface Ctx {
  data: DataContractEnvelope;
  fonts: FontMetrics;
  frame: Frame;
  ops: DrawOp[];
  paper: { width: number; height: number };
}

function layoutNode(ctx: Ctx, node: DocNode): void {
  switch (node.kind) {
    case 'document':
      throw new Error('nested document node is not valid');
    case 'header':
    case 'section':
    case 'footer': {
      // keepTogether is trivially satisfied on a single page: either the
      // whole block fits or the document overflows and fails.
      let first = true;
      for (const child of node.children) {
        if (!first) ctx.frame.y -= BLOCK_GAP;
        first = false;
        layoutNode(ctx, child);
      }
      return;
    }
    case 'text':
      return layoutText(ctx, node);
    case 'fieldGrid':
      return layoutFieldGrid(ctx, node);
    case 'table':
      return layoutTable(ctx, node);
    case 'totals':
      return layoutTotals(ctx, node);
    case 'pageNumber':
      return placeLines(ctx, [pageNumberText(node)], ctx.frame.left, ctx.frame.contentWidth, 'l', BODY_SIZE, BODY_LINE, false);
  }
}

// --- text primitives -------------------------------------------------------

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

/** Collapses control whitespace; refuses non-Latin text (routing rule) and text the embedded face cannot draw. */
function checkText(ctx: Ctx, raw: string, bold: boolean): string {
  const text = raw.replace(/[\t\r\n]+/g, ' ');
  const nonLatin = firstNonLatinCodePoint(text);
  if (nonLatin !== undefined) {
    throw new PdfDirectUnsupportedError(
      `non-Latin text (U+${nonLatin.toString(16).toUpperCase().padStart(4, '0')}) is outside the pdf-direct routing rule — ADR-001 routes this document to typst`,
    );
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x20 && !ctx.fonts.hasGlyph(cp, bold)) {
      throw new PdfDirectUnsupportedError(
        `embedded font has no glyph for U+${cp.toString(16).toUpperCase().padStart(4, '0')} — refusing to render a .notdef box`,
      );
    }
  }
  return text;
}

/** Greedy word wrap over real font metrics — the Stage 0 spike's `wrap`, unchanged in spirit. A single word wider than `width` is broken by character so nothing ever escapes its cell. */
function wrap(ctx: Ctx, text: string, width: number, size: number, bold: boolean): string[] {
  const fits = (s: string) => ctx.fonts.widthOf(s, size, bold) <= width;
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (word === '') continue;
    const cand = cur === '' ? word : `${cur} ${word}`;
    if (fits(cand)) {
      cur = cand;
      continue;
    }
    if (cur !== '') lines.push(cur);
    if (fits(word)) {
      cur = word;
      continue;
    }
    // Break an oversized word by character.
    cur = '';
    for (const ch of word) {
      const c2 = cur + ch;
      if (fits(c2) || cur === '') cur = c2;
      else {
        lines.push(cur);
        cur = ch;
      }
    }
  }
  if (cur !== '') lines.push(cur);
  return lines.length > 0 ? lines : [''];
}

function ensureFits(ctx: Ctx, heightPt: number, what: string): void {
  if (ctx.frame.y - heightPt < ctx.frame.bottom) {
    const available = ctx.frame.y - ctx.frame.bottom;
    throw new PdfDirectOverflowError(
      `${what} does not fit on the single page pdf-direct renders: needs ${heightPt.toFixed(1)}pt, ${available.toFixed(1)}pt left above the bottom margin — route this document to typst (ADR-001) or reduce its content`,
    );
  }
}

/** Places pre-wrapped lines at x (aligned within `width`) and advances the cursor. Overflow is checked BEFORE any op is emitted. */
function placeLines(
  ctx: Ctx,
  lines: string[],
  x: number,
  width: number,
  align: 'l' | 'r' | 'c',
  size: number,
  lineHeight: number,
  bold: boolean,
): void {
  ensureFits(ctx, lines.length * lineHeight, 'text block');
  emitLines(ctx, lines, x, ctx.frame.y, width, align, size, lineHeight, bold);
  ctx.frame.y -= lines.length * lineHeight;
}

/** Emits lines starting at `topY` without touching the cursor (used by cell layouts that advance by row). Baseline sits ~80% down the line box. */
function emitLines(
  ctx: Ctx,
  lines: string[],
  x: number,
  topY: number,
  width: number,
  align: 'l' | 'r' | 'c',
  size: number,
  lineHeight: number,
  bold: boolean,
): void {
  const descentPad = (lineHeight - size) / 2 + size * 0.22;
  lines.forEach((line, i) => {
    const w = ctx.fonts.widthOf(line, size, bold);
    const tx = align === 'l' ? x : align === 'r' ? x + width - w : x + (width - w) / 2;
    ctx.ops.push({ op: 'text', text: line, x: tx, y: topY - (i + 1) * lineHeight + descentPad, size, bold });
  });
}

// --- node kinds -----------------------------------------------------------

function layoutText(ctx: Ctx, node: Extract<DocNode, { kind: 'text' }>): void {
  const bold = node.style === 'title';
  const size = bold ? TITLE_SIZE : BODY_SIZE;
  const lh = bold ? TITLE_LINE : BODY_LINE;
  const text = checkText(ctx, stringify(evaluateExpression(node.value, ctx.data)), bold);
  placeLines(ctx, wrap(ctx, text, ctx.frame.contentWidth, size, bold), ctx.frame.left, ctx.frame.contentWidth, 'l', size, lh, bold);
}

function layoutFieldGrid(ctx: Ctx, node: Extract<DocNode, { kind: 'fieldGrid' }>): void {
  const cols = Math.max(1, node.columns);
  const cellW = (ctx.frame.contentWidth - GRID_COLUMN_GUTTER * (cols - 1)) / cols;
  const spaceW = ctx.fonts.widthOf(' ', BODY_SIZE, false);

  // Each cell becomes [label-run, value-run] pairs per line; lay out row by row.
  interface Cell { labelBold: string; lines: string[]; inlineValue: boolean }
  const cells: Cell[] = node.fields.map((f) => {
    const label = checkText(ctx, `${f.label}:`, true);
    const value = checkText(ctx, stringify(evaluateExpression(f.value, ctx.data)), false);
    const labelW = ctx.fonts.widthOf(label, BODY_SIZE, true);
    const inlineW = cellW - labelW - spaceW;
    if (inlineW > 0 && ctx.fonts.widthOf(value, BODY_SIZE, false) <= inlineW) {
      return { labelBold: label, lines: [value], inlineValue: true };
    }
    return { labelBold: label, lines: wrap(ctx, value, cellW, BODY_SIZE, false), inlineValue: false };
  });

  for (let r = 0; r < cells.length; r += cols) {
    const row = cells.slice(r, r + cols);
    const rowLines = Math.max(...row.map((c) => (c.inlineValue ? 1 : 1 + c.lines.length)));
    const rowH = rowLines * BODY_LINE + (r + cols < cells.length ? GRID_ROW_GUTTER : 0);
    ensureFits(ctx, rowH, 'field grid row');
    row.forEach((cell, i) => {
      const x = ctx.frame.left + i * (cellW + GRID_COLUMN_GUTTER);
      emitLines(ctx, [cell.labelBold], x, ctx.frame.y, cellW, 'l', BODY_SIZE, BODY_LINE, true);
      if (cell.inlineValue) {
        const labelW = ctx.fonts.widthOf(cell.labelBold, BODY_SIZE, true);
        emitLines(ctx, cell.lines, x + labelW + spaceW, ctx.frame.y, cellW - labelW - spaceW, 'l', BODY_SIZE, BODY_LINE, false);
      } else {
        emitLines(ctx, cell.lines, x, ctx.frame.y - BODY_LINE, cellW, 'l', BODY_SIZE, BODY_LINE, false);
      }
    });
    ctx.frame.y -= rowH;
  }
}

function columnWidths(columns: TableColumn[], contentWidth: number): number[] {
  const fixed = columns.reduce((sum, c) => sum + (c.width === 'flex' ? 0 : c.width), 0);
  const flexCount = columns.filter((c) => c.width === 'flex').length;
  const flexW = flexCount > 0 ? Math.max(0, contentWidth - fixed) / flexCount : 0;
  return columns.map((c) => (c.width === 'flex' ? flexW : c.width));
}

function formatCell(key: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && isMoneyAmountPath(key)) return formatMoneyCents(value);
  return stringify(value);
}

function layoutTable(ctx: Ctx, node: Extract<DocNode, { kind: 'table' }>): void {
  if (node.carryForward !== undefined) {
    throw new PdfDirectUnsupportedError(
      `table.carryForward ('${node.carryForward}') is outside the pdf-direct routing rule — carry-forward documents are typst's (ADR-001); this template must declare renderer "typst"`,
    );
  }
  const bound = evaluateExpression(node.bind, ctx.data);
  const rows: unknown[] = Array.isArray(bound) ? bound : [];
  const widths = columnWidths(node.columns, ctx.frame.contentWidth);
  const xs: number[] = [];
  let acc = ctx.frame.left;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }
  const tableRight = acc;

  const wrapCells = (texts: string[], bold: boolean): string[][] =>
    texts.map((t, i) => wrap(ctx, t, Math.max(1, widths[i] - 2 * CELL_INSET), BODY_SIZE, bold));

  const headerCells = wrapCells(node.columns.map((c) => checkText(ctx, c.label, true)), true);
  const bodyCells = rows.map((row) =>
    wrapCells(node.columns.map((c) => checkText(ctx, formatCell(c.key, evaluateRelative(c.key, row)), false)), false),
  );

  const rowHeight = (cells: string[][]) => Math.max(...cells.map((l) => l.length)) * BODY_LINE + 2 * CELL_INSET;

  const totalH = rowHeight(headerCells) + bodyCells.reduce((sum, c) => sum + rowHeight(c), 0);
  ensureFits(ctx, totalH, `table (${rows.length} rows)`);

  const topY = ctx.frame.y;
  const placeRow = (cells: string[][], bold: boolean) => {
    const h = rowHeight(cells);
    ctx.ops.push({ op: 'line', x1: ctx.frame.left, y1: ctx.frame.y, x2: tableRight, y2: ctx.frame.y, thickness: STROKE, gray: 0.5 });
    cells.forEach((lines, i) => {
      emitLines(ctx, lines, xs[i] + CELL_INSET, ctx.frame.y - CELL_INSET, widths[i] - 2 * CELL_INSET, node.columns[i].align, BODY_SIZE, BODY_LINE, bold);
    });
    ctx.frame.y -= h;
  };
  placeRow(headerCells, true);
  for (const cells of bodyCells) placeRow(cells, false);

  const bottomY = ctx.frame.y;
  ctx.ops.push({ op: 'line', x1: ctx.frame.left, y1: bottomY, x2: tableRight, y2: bottomY, thickness: STROKE, gray: 0.5 });
  for (const x of [...xs, tableRight]) {
    ctx.ops.push({ op: 'line', x1: x, y1: topY, x2: x, y2: bottomY, thickness: STROKE, gray: 0.5 });
  }
}

function layoutTotals(ctx: Ctx, node: Extract<DocNode, { kind: 'totals' }>): void {
  const rows = node.rows.map((r) => {
    const value = evaluateExpression(r.value, ctx.data);
    const text = typeof value === 'number' ? formatMoneyCents(value) : stringify(value);
    return { label: checkText(ctx, r.label, false), value: checkText(ctx, text, false) };
  });
  const labelW = Math.max(0, ...rows.map((r) => ctx.fonts.widthOf(r.label, BODY_SIZE, false))) + 2 * CELL_INSET;
  const valueW = Math.max(0, ...rows.map((r) => ctx.fonts.widthOf(r.value, BODY_SIZE, false))) + 2 * CELL_INSET;
  const rowH = BODY_LINE + 2 * CELL_INSET;
  ensureFits(ctx, rows.length * rowH, 'totals block');

  const valueX = ctx.frame.right - valueW;
  const labelX = valueX - labelW;
  for (const r of rows) {
    emitLines(ctx, [r.label], labelX + CELL_INSET, ctx.frame.y - CELL_INSET, labelW - 2 * CELL_INSET, 'l', BODY_SIZE, BODY_LINE, false);
    emitLines(ctx, [r.value], valueX + CELL_INSET, ctx.frame.y - CELL_INSET, valueW - 2 * CELL_INSET, 'r', BODY_SIZE, BODY_LINE, false);
    ctx.frame.y -= rowH;
  }
}

function pageNumberText(node: Extract<DocNode, { kind: 'pageNumber' }>): string {
  const format = node.format ?? 'Page {page} of {pages}';
  return format.replaceAll('{page}', '1').replaceAll('{pages}', '1');
}

/** Page footer: centred in the bottom margin band, like Typst's default footer placement. Never competes with body content for space. */
function layoutPageFooter(ctx: Ctx, children: DocNode[]): void {
  const parts = children.map((c) => {
    if (c.kind === 'pageNumber') return pageNumberText(c);
    throw new PdfDirectUnsupportedError(`footer child kind '${c.kind}' is not supported by pdf-direct (only pageNumber is meaningful in a page footer)`);
  });
  const text = checkText(ctx, parts.join(' '), false);
  const w = ctx.fonts.widthOf(text, BODY_SIZE, false);
  const y = ctx.frame.bottom / 2;
  ctx.ops.push({ op: 'text', text, x: ctx.frame.left + (ctx.frame.contentWidth - w) / 2, y, size: BODY_SIZE, bold: false });
}
