/**
 * Walks a bound `DocNode` tree (packages/schema/src/document/nodes.ts) and
 * emits Typst markup implementing all nine frozen node kinds. Every bound
 * expression is evaluated here, in JS, against the real data (evaluate.ts)
 * — the ONE exception is a `table.carryForward` running total, which can
 * only be known once Typst has decided where page breaks land, so that one
 * value is computed Typst-side using the `state()` pattern proven in the
 * Stage 0 spike (git show 526b038:spike/typst/po.typ). Every other value is
 * already-resolved data, embedded as escaped literal text — no `json()`
 * load, no `--root` needed.
 *
 * DESIGN DECISIONS (judgment calls, not grammar/schema facts — recorded here
 * since nothing upstream pins them):
 *
 * 1. `document.page.margin` is read as `[top, right, bottom, left]` (CSS
 *    order) in points. Nothing in nodes.ts documents the order or unit;
 *    this is the most common convention and is applied consistently.
 * 2. A top-level `header` DocNode renders as normal in-flow content at the
 *    top of page 1 (title + fieldGrid are rich, one-time content) — NOT a
 *    repeating Typst page header. A top-level `footer` DocNode DOES become
 *    a repeating Typst page footer (`#set page(footer: ...)`), since the
 *    only footer content the frozen kinds allow is `pageNumber`, which only
 *    makes sense repeated on every page. Both choices are template-shape
 *    decisions, not grammar ones; a future template needing a genuinely
 *    repeating page *header* would need either a convention change here or
 *    (more likely) is exactly the kind of need that should be reported
 *    rather than silently special-cased.
 * 3. `table.carryForward`'s column is assumed to be the table's LAST
 *    column, matching both the PO and invoice paper-test templates
 *    (`netAmount.amount` is always last). The carry-forward footer row
 *    spans every column except the last with a "Carried forward" label and
 *    shows the running total in the last cell. A future table with the
 *    carry column elsewhere would need this generalized.
 *
 * OVERFLOW GUARD (Gate 4 — HLD §9, "overflow -> FAILED, never silent
 * clipping"): Typst does NOT error or warn when an unbreakable
 * (`breakable: false`) block is taller than the page — confirmed
 * empirically, in TWO different silent-clipping shapes, neither raising a
 * diagnostic or a non-zero exit code:
 *   (a) a bare unbreakable flow of paragraphs (no internal pagination of
 *       its own) draws straight past the page's bottom edge — its real
 *       layout position, read back via `here().position()`, ends up
 *       hundreds of points beyond the page height;
 *   (b) a `table()` inside an unbreakable block — which is what `totals`
 *       actually emits — behaves differently: Typst clips/truncates the
 *       table to fit the single region it's given, so a position read
 *       via `here().position()` immediately after the block is
 *       (mis-leadingly) reported as landing EXACTLY at the region
 *       boundary, not beyond it. Rows past that boundary are silently
 *       dropped from the visible output; some are rendered overlapping
 *       garbage right at the cutoff (verified visually via
 *       `typst compile ... -f png`). A `here().position()` guard (tried
 *       first) does NOT detect this shape at all — it was replaced with
 *       the technique below after that gap was found empirically.
 *
 * The fix that reliably catches BOTH shapes: `measure()` the totals
 * content's true, unclamped natural height (Typst's `measure()` computes
 * layout size without placing anything on a page, so it isn't subject to
 * either clipping behavior above) and compare it, in a `context` block,
 * against the full single-page content height (page height minus top and
 * bottom margins — computed once in JS and embedded as a literal, so no
 * `page` context lookup is needed). If the content is taller than a
 * completely empty page could ever hold, it is GUARANTEED to be silently
 * clipped somewhere no matter where it starts — that is exactly, and only,
 * the condition this guard flags. It deliberately does NOT flag the
 * ordinary, correct case where `keepTogether` pushes a block that fits
 * fine onto a fresh page (case 005 in the corpus) — only the case where no
 * page could ever hold it.
 * `packages/render-typst/src/renderer.ts` reads the measured height back
 * via `typst query` and throws if it exceeds the page's content height.
 * See renderer.ts for the second, independent guard (a hard page-count
 * cap) — the two catch different failure shapes.
 */
import type { DataContractEnvelope, DocNode, TableColumn } from '@busy-office/output-schema';
import { evaluateExpression, evaluateRelative } from './evaluate.js';
import { formatAddressLines, formatDisplayValue, isAddressLike } from './format.js';
import { escapeTypstMarkup } from './typst-escape.js';

export const OVERFLOW_MARKER_LABEL = 'bo-totals-end';

const PAPER_PT: Record<'A4' | 'Letter', { width: number; height: number }> = {
  A4: { width: 595.2756, height: 841.8898 }, // 210mm x 297mm
  Letter: { width: 612, height: 792 }, // 8.5in x 11in
};

export interface EmitResult {
  markup: string;
  /** A full single page's content height in pt (page height minus top+bottom margins) — the overflow-guard threshold. */
  fullPageContentHeightPt: number;
}

interface PageMetrics {
  contentWidthPt: number;
  fullPageContentHeightPt: number;
}

export function emitDocument(root: DocNode, data: DataContractEnvelope, locale?: string): EmitResult {
  if (root.kind !== 'document') {
    throw new Error(`LayoutIR.root must be kind 'document', got '${root.kind}'`);
  }
  const paper = PAPER_PT[root.page.size];
  const [top, right, bottom, left] = root.page.margin;
  const fullPageContentHeightPt = paper.height - top - bottom;
  const metrics: PageMetrics = { contentWidthPt: paper.width - left - right, fullPageContentHeightPt };

  const footerNode = root.children.find((c) => c.kind === 'footer');
  const bodyChildren = root.children.filter((c) => c.kind !== 'footer');

  const usesCarryForward = treeUsesCarryForward(root);

  const pageFooter =
    footerNode && footerNode.kind === 'footer' ? emitPageFooterContext(footerNode.children) : undefined;

  const lines: string[] = [];
  lines.push(
    `#set page(paper: "${typstPaper(root.page.size)}", margin: (top: ${top}pt, right: ${right}pt, bottom: ${bottom}pt, left: ${left}pt)${
      pageFooter ? `, footer: ${pageFooter}` : ''
    })`,
  );
  lines.push('#set text(size: 9pt)');
  // Stage 6: `#set text(lang: ...)` drives Typst's per-language hyphenation
  // and number-context choices for the four exit-gate locales' scripts —
  // Typst's font *fallback* (the actual CJK/RTL glyph coverage) is already
  // proven independent of this (docs/RESULTS.md's RTL/CJK smoke test, ADR-001)
  // and needs no explicit font request. Bidi reordering/shaping for Arabic
  // runs automatically off the Unicode content itself (same RESULTS.md
  // finding), so `dir` is deliberately left at Typst's default rather than
  // forced globally — forcing it would mirror the whole page layout
  // (margins, table column order), which is layout/typography polish this
  // Stage 0-2 rule ("never optimize typography") and this task's scope
  // (correctness of the text content, not page mirroring) don't call for.
  const langTag = localeLangTag(locale);
  if (langTag) lines.push(`#set text(lang: "${langTag}")`);
  if (usesCarryForward) {
    lines.push(TYPST_MONEY_HELPER);
    lines.push('#let running = state("bo-running", 0)');
  }

  for (const child of bodyChildren) {
    lines.push(emitNode(child, data, metrics, locale));
  }

  return { markup: lines.join('\n\n'), fullPageContentHeightPt };
}

/** BCP-47 locale -> Typst's `text(lang:)` 2-letter code (the primary language subtag). */
function localeLangTag(locale?: string): string | undefined {
  if (!locale) return undefined;
  const primary = locale.split('-')[0];
  return primary.length === 2 ? primary.toLowerCase() : undefined;
}

function typstPaper(size: 'A4' | 'Letter'): string {
  return size === 'A4' ? 'a4' : 'us-letter';
}

const TYPST_MONEY_HELPER = `#let bo-money(cents) = {
  let neg = cents < 0
  let a = calc.abs(calc.round(cents))
  let whole = calc.floor(a / 100)
  let frac = calc.rem(a, 100)
  let ws = str(whole)
  let out = ""
  let i = 0
  for c in ws.rev().clusters() {
    if i != 0 and calc.rem(i, 3) == 0 { out = "," + out }
    out = c + out
    i += 1
  }
  let fs = str(frac)
  if fs.len() == 1 { fs = "0" + fs }
  (if neg { "-" } else { "" }) + out + "." + fs
}`;

function treeUsesCarryForward(node: DocNode): boolean {
  switch (node.kind) {
    case 'document':
    case 'section':
    case 'header':
    case 'footer':
      return node.children.some(treeUsesCarryForward);
    case 'table':
      return Boolean(node.carryForward);
    default:
      return false;
  }
}

function emitNode(node: DocNode, data: DataContractEnvelope, metrics: PageMetrics, locale?: string): string {
  switch (node.kind) {
    case 'document':
      throw new Error('nested document node is not valid');
    case 'header':
      return emitContainer(node.children, data, metrics, false, locale);
    case 'section':
      return emitContainer(node.children, data, metrics, Boolean(node.keepTogether), locale);
    case 'footer':
      // Extracted and handled as a page-level footer in emitDocument; a
      // *nested* footer (not a direct child of document) is out of scope
      // for the frozen templates but rendered in-flow defensively rather
      // than silently dropped.
      return emitContainer(node.children, data, metrics, false, locale);
    case 'text':
      return emitText(node, data, locale);
    case 'fieldGrid':
      return emitFieldGrid(node, data, locale);
    case 'table':
      return emitTable(node, data, locale);
    case 'totals':
      return emitTotals(node, data, metrics, locale);
    case 'pageNumber':
      return emitPageNumber(node);
  }
}

function emitContainer(
  children: DocNode[],
  data: DataContractEnvelope,
  metrics: PageMetrics,
  keepTogether: boolean,
  locale?: string,
): string {
  const inner = children.map((c) => emitNode(c, data, metrics, locale)).join('\n\n');
  return keepTogether ? `#block(breakable: false, width: 100%)[\n${inner}\n]` : inner;
}

function emitText(node: Extract<DocNode, { kind: 'text' }>, data: DataContractEnvelope, locale?: string): string {
  const value = evaluateExpression(node.value, data);
  const text = escapeTypstMarkup(formatDisplayValue(node.value, value, locale));
  if (node.style === 'title') {
    return `#text(size: 16pt, weight: "bold")[${text}]`;
  }
  return text;
}

/** Typst's markup line-break shorthand — a literal backslash followed by whitespace forces a line break inside a bracketed content block. */
const TYPST_LINEBREAK = ' \\\n';

function emitFieldGrid(node: Extract<DocNode, { kind: 'fieldGrid' }>, data: DataContractEnvelope, locale?: string): string {
  const cells = node.fields.map((f) => {
    const value = evaluateExpression(f.value, data);
    const label = escapeTypstMarkup(f.label);
    if (isAddressLike(value)) {
      // Multi-line form (Stage 6 locale-aware address ordering,
      // format.ts's `formatAddressLines`) — the single-line
      // `formatDisplayValue` fallback (comma-joined) is for contexts that
      // can't break lines, not this one.
      const addrLines = formatAddressLines(value, locale).map((l) => escapeTypstMarkup(l));
      return `[*${label}:*${TYPST_LINEBREAK}${addrLines.join(TYPST_LINEBREAK)}]`;
    }
    return `[*${label}:* ${escapeTypstMarkup(formatDisplayValue(f.value, value, locale))}]`;
  });
  return `#grid(columns: ${node.columns}, column-gutter: 10pt, row-gutter: 4pt,\n  ${cells.join(',\n  ')},\n)`;
}

function alignKeyword(align: 'l' | 'r' | 'c'): string {
  return align === 'l' ? 'left' : align === 'r' ? 'right' : 'center';
}

function colWidthSpec(width: number | 'flex'): string {
  return width === 'flex' ? '1fr' : `${width}pt`;
}

function emitTable(node: Extract<DocNode, { kind: 'table' }>, data: DataContractEnvelope, locale?: string): string {
  const bound = evaluateExpression(node.bind, data);
  const rows: unknown[] = Array.isArray(bound) ? bound : [];
  const colSpecs = node.columns.map((c) => colWidthSpec(c.width)).join(', ');
  const headerCells = node.columns.map((c) => `[*${escapeTypstMarkup(c.label)}*]`).join(', ');

  const bodyRowsMarkup = rows.map((row) => emitTableRow(node.columns, row, node.carryForward, locale));

  const parts: string[] = [`table.header(repeat: true, ${headerCells})`];
  if (bodyRowsMarkup.length > 0) parts.push(bodyRowsMarkup.join(',\n  '));
  if (node.carryForward) {
    const lastIdx = node.columns.length - 1;
    parts.push(
      `table.footer(\n    repeat: true,\n    table.cell(colspan: ${lastIdx}, align: right)[_Carried forward_],\n    table.cell(align: right, context [_#bo-money(running.at(here()))_]),\n  )`,
    );
  }

  return `#table(\n  columns: (${colSpecs}),\n  stroke: 0.4pt + gray,\n  inset: 3pt,\n  ${parts.join(',\n  ')},\n)`;
}

function emitTableRow(columns: TableColumn[], row: unknown, carryForward: string | undefined, locale?: string): string {
  const cells = columns.map((col) => {
    const raw = evaluateRelative(col.key, row);
    const text = escapeTypstMarkup(formatDisplayValue(col.key, raw, locale));
    const align = alignKeyword(col.align);
    if (carryForward && col.key === carryForward) {
      const cents = typeof raw === 'number' ? raw : 0;
      return `align(${align}, [${text}#running.update(x => x + ${cents})])`;
    }
    return `align(${align}, [${text}])`;
  });
  return cells.join(', ');
}

function emitTotals(
  node: Extract<DocNode, { kind: 'totals' }>,
  data: DataContractEnvelope,
  metrics: PageMetrics,
  locale?: string,
): string {
  const rows = node.rows.map((r) => {
    const value = evaluateExpression(r.value, data);
    const text = formatDisplayValue(r.value, value, locale);
    return `  [${escapeTypstMarkup(r.label)}], [${escapeTypstMarkup(text)}],`;
  });
  const content = `[\n  #align(right)[\n    #table(columns: (auto, auto), stroke: none, inset: 3pt,\n${rows.join('\n')}\n    )\n  ]\n]`;
  // See this file's header comment for why measure() (not a position
  // marker) is the guard: it reads the content's true, unclamped natural
  // height, which a page-fitted position marker cannot for table content.
  const marker =
    `#let bo-totals-content = ${content}\n` +
    `#context {\n` +
    `  let h = measure(bo-totals-content, width: ${metrics.contentWidthPt}pt).height\n` +
    `  [#metadata((heightPt: h.pt(), fullPageContentHeightPt: ${metrics.fullPageContentHeightPt})) <${OVERFLOW_MARKER_LABEL}>]\n` +
    `}`;
  return `${marker}\n\n#block(breakable: false, width: 100%)[\n  #bo-totals-content\n]`;
}

/** The content *fragment* for a pageNumber node — valid only inside an already-open `context [...]` block. */
function pageNumberFragment(node: Extract<DocNode, { kind: 'pageNumber' }>): string {
  const format = node.format ?? 'Page {page} of {pages}';
  const tokenRe = /\{page\}|\{pages\}/g;
  let last = 0;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(format))) {
    out += escapeTypstMarkup(format.slice(last, m.index));
    out += m[0] === '{page}' ? '#counter(page).display()' : '#counter(page).final().at(0)';
    last = tokenRe.lastIndex;
  }
  out += escapeTypstMarkup(format.slice(last));
  return out;
}

/** Standalone use (defensive — pageNumber appears in the frozen templates only inside footer). */
function emitPageNumber(node: Extract<DocNode, { kind: 'pageNumber' }>): string {
  return `context [${pageNumberFragment(node)}]`;
}

/** Builds the `context [...]` expression used as `#set page(footer: ...)`. */
function emitPageFooterContext(children: DocNode[]): string {
  // pageNumber is the only frozen kind meaningful in a repeating footer —
  // its `#counter(...)` calls need the single outer `context` this
  // function provides; any other child kind found here is rendered as
  // plain escaped text rather than silently dropped.
  const inner = children
    .map((c) => (c.kind === 'pageNumber' ? pageNumberFragment(c) : escapeTypstMarkup(JSON.stringify(c))))
    .join(' ');
  return `context [${inner}]`;
}
