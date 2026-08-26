/**
 * DRAFT — Path A only. Frozen until ADR-000 is decided; deleted if Path B wins.
 * Nine node types (roadmap Stage 2). If writing the PO and invoice templates
 * on paper needs a tenth, the schema is not done (Stage 1 gate).
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
