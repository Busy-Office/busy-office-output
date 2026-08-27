import { expect } from 'vitest';
import { normalizePdf } from '@busy-office/render-typst';
import type { PurchaseOrderData } from '@busy-office/output-schema';
import { renderPurchaseOrder } from './render.js';

/**
 * ROADMAP Stage 2 DoD: "two consecutive renders byte-match after
 * normalization". Renders `data` twice, normalizes both (zeroes
 * CreationDate/ModDate/doc ID), and asserts byte-for-byte equality.
 */
export async function assertDeterministic(data: PurchaseOrderData): Promise<Uint8Array> {
  const a = await renderPurchaseOrder(data);
  const b = await renderPurchaseOrder(data);
  const na = normalizePdf(a.bytes);
  const nb = normalizePdf(b.bytes);
  expect(Buffer.from(na).equals(Buffer.from(nb))).toBe(true);
  return na;
}
