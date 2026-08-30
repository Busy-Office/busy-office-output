/**
 * Structural diff (Review-and-approve's compare mechanic;
 * docs/UI-DESIGN.md — the future authoring Workspace reuses it). PURE: a
 * deterministic, recursive, JSON-pointer-addressed diff of two plain JSON
 * values — a `DocNode` tree, a message template's `{ subject, body }`
 * segments, or a meta slice — with NO rendering, NO renderer involved
 * (the deliberately-absent list: no typst compare, no sample drop).
 *
 * Rows come out oldest-pointer-first in a stable order (object keys
 * sorted, array indices ascending), so the same two inputs always give
 * the same rows — the screen's compare section is reproducible and
 * testable byte-for-byte.
 *
 *   + /children/3 (text header.title)    — present in `proposed` only
 *   - /children/1 (table lines)          — present in `current` only
 *   ~ /page/margin [40,40,40,40] → [50,40,40,40]   — leaf changed
 *
 * Arrays whose every element is a primitive (a margin tuple, a plain
 * string segment list) are compared as ONE leaf; arrays holding objects
 * (children, columns, mixed segments) are compared index-wise. Values in
 * rows are template facts (node kinds, expressions, page specs) — never
 * data-contract payloads, which this module never sees.
 */

export type DiffOp = '+' | '-' | '~';

export interface DiffRow {
  op: DiffOp;
  /** RFC 6901 JSON pointer into the compared value ("" is the root). */
  pointer: string;
  /** Human-readable detail: a node label for `+`/`-`, `a → b` for `~`. */
  detail: string;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isObject(value: unknown): value is { [key: string]: Json } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitiveArray(value: unknown): value is Array<null | boolean | number | string> {
  return Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object');
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** One-line label for a value that appears on only one side. */
export function describeValue(value: unknown): string {
  if (isObject(value)) {
    if (typeof value.kind === 'string') {
      const label = value.value ?? value.bind ?? value.format ?? value.style ?? '';
      return `(${value.kind}${label === '' ? '' : ` ${String(label)}`})`;
    }
    if (typeof value.expr === 'string') return `(expr ${value.expr})`;
    return `(object ${Object.keys(value).sort().join(',')})`;
  }
  if (Array.isArray(value)) return `(array ×${value.length})`;
  return `= ${JSON.stringify(value)}`;
}

function leafText(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Diff `current` (the baseline) against `proposed`. Equal inputs give
 * `[]`. Both inputs must be plain JSON data (no functions, no cycles).
 */
export function structuralDiff(current: unknown, proposed: unknown, pointer = ''): DiffRow[] {
  const rows: DiffRow[] = [];
  walk(current, proposed, pointer, rows);
  return rows;
}

function walk(a: unknown, b: unknown, pointer: string, rows: DiffRow[]): void {
  if (a === undefined && b !== undefined) {
    rows.push({ op: '+', pointer, detail: describeValue(b) });
    return;
  }
  if (b === undefined && a !== undefined) {
    rows.push({ op: '-', pointer, detail: describeValue(a) });
    return;
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) walk(a[key], b[key], `${pointer}/${escapePointerToken(key)}`, rows);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && !(isPrimitiveArray(a) && isPrimitiveArray(b))) {
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) walk(a[i], b[i], `${pointer}/${i}`, rows);
    return;
  }
  const left = leafText(a);
  const right = leafText(b);
  if (left !== right) rows.push({ op: '~', pointer, detail: `${left} → ${right}` });
}

/** The row as the screen prints it: `<op> <pointer> <detail>`. */
export function formatDiffRow(row: DiffRow): string {
  return `${row.op} ${row.pointer === '' ? '/' : row.pointer} ${row.detail}`;
}
