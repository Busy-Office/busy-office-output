/**
 * FROZEN — Path A (ADR-000 Accepted 2026-08-26, Option C hybrid; Path A is
 * the active path). Nine node types. `value`/`bind`/`key` fields hold
 * expressions per docs/EXPRESSION-GRAMMAR.md, parsed by
 * packages/schema/src/expression/parse.ts. If writing the PO and invoice
 * templates on paper needs a tenth, this freeze was wrong — that's the
 * paper-test gate.
 */
export type DocNode =
  | { kind: 'document'; page: PageSpec; children: DocNode[] }
  | { kind: 'section'; children: DocNode[]; keepTogether?: boolean }
  | { kind: 'text'; value: string /* expression */; style?: string }
  | { kind: 'fieldGrid'; columns: number; fields: Array<{ label: string; value: string }> }
  | { kind: 'table'; bind: string; columns: TableColumn[]; repeatHeader: true; carryForward?: string }
  | { kind: 'totals'; rows: Array<{ label: string; value: string }>; keepTogether: true }
  | { kind: 'header'; children: DocNode[] }
  | { kind: 'footer'; children: DocNode[] }
  | { kind: 'pageNumber'; format?: string };

export interface PageSpec { size: 'A4' | 'Letter'; margin: [number, number, number, number] }
export interface TableColumn { key: string; width: number | 'flex'; align: 'l' | 'r' | 'c'; label: string }
