import { describe, expect, it } from 'vitest';
import type { DataContractEnvelope, DocNode, LayoutIR } from '@busy-office/output-schema';
import { TypstRenderer } from '../renderer.js';
import { diffPdfBytes, formatStructuralDiff } from './structural-diff.js';

const renderer = new TypstRenderer();

const data: DataContractEnvelope<{ title: string }> = {
  schemaVersion: '1.0.0',
  documentType: 'diff-fixture',
  header: { title: 'Fixture' },
};

function docWithText(value: string): DocNode {
  return {
    kind: 'document',
    page: { size: 'A4', margin: [40, 40, 40, 40] },
    children: [{ kind: 'text', value }],
  };
}

async function renderText(literalValue: string): Promise<Uint8Array> {
  // `text.value` is an expression path, so route through a fixed path and
  // vary the *data* it resolves to — keeps this fixture within the frozen
  // expression grammar (dot-paths only, no literals).
  const ir: LayoutIR = {
    irVersion: '1.0.0',
    root: docWithText('header.title'),
    data: { ...data, header: { title: literalValue } },
  };
  const artifact = await renderer.render({ kind: 'ir', ir });
  return artifact.bytes;
}

describe('structural-diff', () => {
  it('reports no differences for byte-identical renders', async () => {
    const bytes = await renderText('Hello World');
    const diff = await diffPdfBytes(bytes, bytes);
    expect(diff.identical).toBe(true);
    expect(diff.pageCountDelta).toBe(0);
    expect(formatStructuralDiff(diff)).toContain('No structural differences.');
  }, 30000);

  it('reports a readable word-level delta for a changed text node', async () => {
    const a = await renderText('Hello World');
    const b = await renderText('Hello Universe');
    const diff = await diffPdfBytes(a, b);

    expect(diff.identical).toBe(false);
    expect(diff.pageCountDelta).toBe(0);
    expect(diff.pages).toHaveLength(1);

    const report = formatStructuralDiff(diff);
    expect(report).toContain('- "World"');
    expect(report).toContain('+ "Universe"');
    expect(report).not.toContain('World'.repeat(2)); // sanity: not just "different"
  }, 30000);
});
