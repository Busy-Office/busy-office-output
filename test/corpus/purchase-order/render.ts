import { TypstRenderer } from '@busy-office/render-typst';
import type { LayoutIR, PurchaseOrderData } from '@busy-office/output-schema';
import { purchaseOrderTemplate } from './template.js';

const renderer = new TypstRenderer();

export function toLayoutIR(data: PurchaseOrderData): LayoutIR {
  return { irVersion: '1.0.0', root: purchaseOrderTemplate, data };
}

export async function renderPurchaseOrder(data: PurchaseOrderData, opts?: { locale?: string }) {
  return renderer.render({ kind: 'ir', ir: toLayoutIR(data) }, opts);
}

export { renderer };
