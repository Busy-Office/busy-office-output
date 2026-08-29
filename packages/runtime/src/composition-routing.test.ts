import { describe, expect, it } from 'vitest';
import type { Renderer } from '@busy-office/output-schema';
import { builtinDocumentTypes } from '../document-types/index.js';
import { selectRenderer, type CompositionDeps } from './composition.js';

function fakeRenderer(id: string): Renderer {
  return { id, version: '0', accepts: ['ir'], render: async () => ({ mediaType: 'application/pdf', bytes: new Uint8Array() }) };
}

const typst = fakeRenderer('typst');
const pdfDirect = fakeRenderer('pdf-direct');

// Only `renderer`/`renderers` are consulted by selectRenderer; the stores are irrelevant here.
const deps = (renderers?: Record<string, Renderer>): CompositionDeps =>
  ({ renderer: typst, renderers }) as unknown as CompositionDeps;

/**
 * The routing decision point (ADR-002 task): `TemplateMeta.renderer` →
 * `Resolution.renderer` → registry lookup. Unknown ids fail loudly; the
 * default is only used when a resolution carries no id at all.
 */
describe('selectRenderer', () => {
  it('routes by the resolution.renderer id through the registry', () => {
    expect(selectRenderer(deps({ typst, 'pdf-direct': pdfDirect }), { templateId: 't', renderer: 'pdf-direct' })).toBe(pdfDirect);
    expect(selectRenderer(deps({ typst, 'pdf-direct': pdfDirect }), { templateId: 't', renderer: 'typst' })).toBe(typst);
  });

  it('falls back to the default renderer only when the resolution has no renderer id (pre-field outbox rows)', () => {
    expect(selectRenderer(deps({ 'pdf-direct': pdfDirect }), { templateId: 't' })).toBe(typst);
  });

  it("serves the default renderer's own id without a registry, and ahead of a registry entry with the same id", () => {
    expect(selectRenderer(deps(), { templateId: 't', renderer: 'typst' })).toBe(typst);
    const swapped = fakeRenderer('typst');
    const withSwap = { ...deps({ typst, 'pdf-direct': pdfDirect }), renderer: swapped };
    expect(selectRenderer(withSwap, { templateId: 't', renderer: 'typst' })).toBe(swapped);
  });

  it('never silently substitutes the default for an unknown id', () => {
    expect(() => selectRenderer(deps(), { templateId: 'payslip-companyCode-1000-v1', renderer: 'pdf-direct' })).toThrow(
      /declares renderer 'pdf-direct', but no renderer with that id is registered/,
    );
  });
});

describe('templates on disk', () => {
  it('exactly one real template routes to pdf-direct: payslip-companyCode-1000-v1; every other template stays typst', () => {
    const templates = builtinDocumentTypes.flatMap((d) => d.templates.map((t) => t.meta));
    const byRenderer = new Map<string, string[]>();
    for (const t of templates) byRenderer.set(t.renderer, [...(byRenderer.get(t.renderer) ?? []), t.id]);
    expect(byRenderer.get('pdf-direct')).toEqual(['payslip-companyCode-1000-v1']);
    expect(new Set(byRenderer.keys())).toEqual(new Set(['typst', 'pdf-direct']));
  });
});
