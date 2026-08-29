import { expect } from 'vitest';
import { normalizePdf } from '@busy-office/render-typst';
import type { PurchaseOrderData } from '@busy-office/output-schema';
import { renderPurchaseOrder } from './render.js';
import { assertPdfA } from './pdfa-assert.js';

/**
 * ROADMAP Stage 2 DoD: "two consecutive renders byte-match after
 * normalization". Renders `data` twice, normalizes both (zeroes
 * CreationDate/ModDate/doc ID), and asserts byte-for-byte equality.
 *
 * Also asserts PDF/A-2b compliance on the render (ADR-006, docs/STANDARDS.md
 * Tier 2: "veraPDF in the corpus gates") — every corpus case that renders
 * through this helper is a veraPDF-validated artifact, not a separate manual
 * step. Checked once, against the first (unnormalized) render — normalization
 * only zero-fills existing fields to the same byte length, it does not change
 * PDF/A conformance.
 */
export async function assertDeterministic(data: PurchaseOrderData, opts?: { locale?: string }): Promise<Uint8Array> {
  const a = await renderPurchaseOrder(data, opts);
  const b = await renderPurchaseOrder(data, opts);
  await assertPdfA(a.bytes);
  const na = normalizePdf(a.bytes);
  const nb = normalizePdf(b.bytes);
  expect(Buffer.from(na).equals(Buffer.from(nb))).toBe(true);
  return na;
}
