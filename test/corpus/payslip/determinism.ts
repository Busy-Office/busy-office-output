import { expect } from 'vitest';
import { normalizePdf } from '@busy-office/render-typst';
import type { PayslipData } from '@busy-office/output-schema';
import { renderPayslip } from './render.js';
// Reused, not reimplemented (ROADMAP Stage 4 task constraint) — `assertPdfA`
// operates purely on PDF bytes, no purchase-order-specific typing.
import { assertPdfA } from '../purchase-order/pdfa-assert.js';

/**
 * Same determinism proof as test/corpus/invoice/determinism.ts and
 * test/corpus/purchase-order/determinism.ts: renders `data` twice,
 * normalizes both (zeroes CreationDate/ModDate/doc ID), and asserts
 * byte-for-byte equality. Also asserts PDF/A-2b compliance (ADR-006 /
 * docs/STANDARDS.md Tier 2) on the first render via the shared
 * `assertPdfA` helper.
 */
export async function assertDeterministic(data: PayslipData): Promise<Uint8Array> {
  const a = await renderPayslip(data);
  const b = await renderPayslip(data);
  await assertPdfA(a.bytes);
  const na = normalizePdf(a.bytes);
  const nb = normalizePdf(b.bytes);
  expect(Buffer.from(na).equals(Buffer.from(nb))).toBe(true);
  return na;
}
