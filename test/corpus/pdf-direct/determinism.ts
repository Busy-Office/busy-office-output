import { expect } from 'vitest';
import { normalizePdf } from '@busy-office/render-typst';
import type { Artifact } from '@busy-office/output-schema';
import { assertPdfA } from '../purchase-order/pdfa-assert.js';

/**
 * Same contract as test/corpus/purchase-order/determinism.ts, renderer-
 * agnostic: render twice via `render()`, veraPDF the first, normalize both
 * (render-typst's normalize-pdf.ts — which now also covers pdf-lib's
 * `/CreationDate (D:...)` form), assert byte-for-byte equality. The
 * pdf-direct renderer additionally derives its trailer /ID from a hash of
 * the IR, so the two renders are expected to be identical even BEFORE
 * normalization whenever they land in the same wall-clock second; that is
 * not asserted (it would flake across a second boundary) — the normalized
 * equality is the guarantee the corpus demands.
 */
export async function assertDeterministic(render: () => Promise<Artifact>): Promise<Uint8Array> {
  const a = await render();
  const b = await render();
  await assertPdfA(a.bytes);
  const na = normalizePdf(a.bytes);
  const nb = normalizePdf(b.bytes);
  expect(Buffer.from(na).equals(Buffer.from(nb))).toBe(true);
  return na;
}
