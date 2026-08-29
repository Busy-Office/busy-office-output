/**
 * `sample-memo` — a SYNTHETIC document type defined entirely outside the
 * engine tree, the "one document type registers from outside the engine
 * tree" proof GAP-08 closes on. Deliberately not a credit note or delivery
 * note (those would imply roadmap scope); it is a memo with a header, some
 * numbered text lines, and a line count. Nothing in `packages/` knows it
 * exists; it reaches the runtime only through
 * `OutputPort.registerDocumentType`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocNode } from '@busy-office/output-schema';
import type { DocumentTypeDefinition } from '@busy-office/runtime';

const memoTemplate: DocNode = {
  kind: 'document',
  page: { size: 'A4', margin: [40, 40, 40, 40] },
  children: [
    {
      kind: 'header',
      children: [
        { kind: 'text', value: 'header.subject', style: 'title' },
        {
          kind: 'fieldGrid',
          columns: 2,
          fields: [
            { label: 'Memo', value: 'header.memoNumber' },
            { label: 'Date', value: 'header.memoDate' },
            { label: 'From', value: 'header.from' },
            { label: 'To', value: 'header.to' },
          ],
        },
      ],
    },
    {
      kind: 'section',
      children: [
        {
          kind: 'table',
          bind: 'lines',
          repeatHeader: true,
          columns: [
            { key: 'lineNumber', width: 'flex', align: 'r', label: '#' },
            { key: 'text', width: 'flex', align: 'l', label: 'Text' },
          ],
        },
      ],
    },
    {
      kind: 'totals',
      keepTogether: true,
      rows: [{ label: 'Lines', value: 'totals.lineCount' }],
    },
    {
      kind: 'footer',
      children: [{ kind: 'pageNumber', format: 'Page {page} of {pages}' }],
    },
  ],
};

export const sampleMemo: DocumentTypeDefinition = {
  documentType: 'sample-memo',
  contract: JSON.parse(readFileSync(fileURLToPath(new URL('./contract.schema.json', import.meta.url)), 'utf8')) as object,
  templates: [
    {
      meta: {
        id: 'sample-memo-global-v1',
        variant: { documentType: 'sample-memo' },
        version: '1.0.0',
        lifecycle: 'published',
        renderer: 'typst',
      },
      content: memoTemplate,
    },
  ],
  rules: [
    {
      id: 'sample-memo-default-email',
      conditions: { documentType: 'sample-memo', event: 'memo.sent' },
      resolution: { channel: 'email' },
    },
  ],
};

export function validSampleMemo() {
  return {
    schemaVersion: '1.0.0',
    documentType: 'sample-memo',
    header: {
      memoNumber: 'MEMO-0001',
      memoDate: '2026-08-29',
      subject: 'Registration from outside the engine tree',
      from: 'Output runtime',
      to: 'Whoever registers next',
    },
    lines: [
      { lineNumber: 1, text: 'This document type is not in packages/.' },
      { lineNumber: 2, text: 'It reached the runtime through registerDocumentType.' },
    ],
    totals: { lineCount: 2 },
  };
}
