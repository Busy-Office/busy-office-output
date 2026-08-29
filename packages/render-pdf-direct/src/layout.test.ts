import { describe, expect, it } from 'vitest';
import type { DataContractEnvelope, DocNode } from '@busy-office/output-schema';
import { layoutDocument, PdfDirectOverflowError, PdfDirectUnsupportedError, type FontMetrics } from './layout.js';
import { firstNonLatinCodePoint, isLatinCodePoint } from './latin.js';

/** Fixed-advance fake metrics: every glyph is 0.5em wide, every codepoint has a glyph. Keeps these tests font-file-free. */
const monoMetrics: FontMetrics = {
  widthOf: (text, size) => [...text].length * size * 0.5,
  hasGlyph: () => true,
};

const envelope = (extra: Record<string, unknown>): DataContractEnvelope =>
  ({ schemaVersion: '1.0.0', documentType: 'purchase-order', ...extra }) as unknown as DataContractEnvelope;

function doc(children: DocNode[], margin: [number, number, number, number] = [40, 40, 40, 40]): DocNode {
  return { kind: 'document', page: { size: 'A4', margin }, children };
}

describe('layoutDocument', () => {
  it('places a title, a field grid, a table, totals and a page footer on one page', () => {
    const root = doc([
      { kind: 'header', children: [{ kind: 'text', value: 'header.no', style: 'title' }, { kind: 'fieldGrid', columns: 2, fields: [{ label: 'A', value: 'header.a' }, { label: 'B', value: 'header.b' }] }] },
      { kind: 'section', children: [{ kind: 'table', bind: 'lines', repeatHeader: true, columns: [{ key: 'n', width: 30, align: 'r', label: '#' }, { key: 'amt.amount', width: 'flex', align: 'r', label: 'Amount' }] }] },
      { kind: 'totals', keepTogether: true, rows: [{ label: 'Total', value: 'totals.t.amount' }] },
      { kind: 'footer', children: [{ kind: 'pageNumber' }] },
    ]);
    const data = envelope({ header: { no: 'PO-1', a: 'x', b: 'y' }, lines: [{ n: 1, amt: { amount: 123456 } }], totals: { t: { amount: 123456 } } });
    const layout = layoutDocument(root, data, monoMetrics);
    const texts = layout.ops.filter((o) => o.op === 'text').map((o) => (o as { text: string }).text);
    expect(texts).toContain('PO-1');
    expect(texts).toContain('1,234.56'); // money formatting shared with render-typst
    expect(texts).toContain('Page 1 of 1');
    expect(layout.widthPt).toBeCloseTo(595.2756, 3);
    // Everything painted sits inside the page.
    for (const op of layout.ops) {
      if (op.op === 'text') {
        expect(op.y).toBeGreaterThan(0);
        expect(op.y).toBeLessThan(layout.heightPt);
      }
    }
  });

  it('throws PdfDirectOverflowError, and emits NOTHING, when the content does not fit one page', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ n: i + 1, d: `line ${i + 1}` }));
    const root = doc([{ kind: 'table', bind: 'lines', repeatHeader: true, columns: [{ key: 'n', width: 30, align: 'r', label: '#' }, { key: 'd', width: 'flex', align: 'l', label: 'D' }] }]);
    expect(() => layoutDocument(root, envelope({ lines }), monoMetrics)).toThrow(PdfDirectOverflowError);
  });

  it('refuses a carryForward table (routing rule: Typst owns carry-forward)', () => {
    const root = doc([{ kind: 'table', bind: 'lines', repeatHeader: true, carryForward: 'amt.amount', columns: [{ key: 'amt.amount', width: 'flex', align: 'r', label: 'Amt' }] }]);
    expect(() => layoutDocument(root, envelope({ lines: [] }), monoMetrics)).toThrow(PdfDirectUnsupportedError);
  });

  it('refuses non-Latin text and text the font has no glyph for', () => {
    const root = doc([{ kind: 'text', value: 'header.name' }]);
    expect(() => layoutDocument(root, envelope({ header: { name: '田中' } }), monoMetrics)).toThrow(/non-Latin/);
    const noGlyphs: FontMetrics = { ...monoMetrics, hasGlyph: () => false };
    expect(() => layoutDocument(root, envelope({ header: { name: 'plain' } }), noGlyphs)).toThrow(/no glyph/);
  });

  it('wraps long cell text by word, and breaks an oversized word by character rather than letting it escape the cell', () => {
    const root = doc([{ kind: 'table', bind: 'lines', repeatHeader: true, columns: [{ key: 'd', width: 60, align: 'l', label: 'D' }] }]);
    const data = envelope({ lines: [{ d: 'aaaa bbbb cccc dddd' }, { d: 'x'.repeat(40) }] });
    const layout = layoutDocument(root, data, monoMetrics);
    const texts = layout.ops.filter((o) => o.op === 'text').map((o) => (o as { text: string }).text);
    expect(texts.filter((t) => /^[abcd]+( [abcd]+)*$/.test(t)).length).toBeGreaterThan(1);
    expect(texts.every((t) => monoMetrics.widthOf(t, 9, false) <= 60)).toBe(true);
  });

  it('rejects a root that is not a document', () => {
    expect(() => layoutDocument({ kind: 'text', value: 'x' }, envelope({}), monoMetrics)).toThrow(/must be kind 'document'/);
  });
});

describe('latin', () => {
  it('accepts Basic Latin, Latin-1, Latin Extended and common punctuation', () => {
    expect(firstNonLatinCodePoint('Zoë Ångström-Łukasiewicz — €1,234.56 "quoted" …')).toBeUndefined();
  });
  it('rejects Greek, Cyrillic, CJK, Thai, Arabic', () => {
    for (const s of ['α', 'Ж', '田', 'ส', 'م']) expect(firstNonLatinCodePoint(s)).toBe(s.codePointAt(0));
    expect(isLatinCodePoint(0x0391)).toBe(false);
  });
});
