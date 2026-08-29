import { PdfDirectRenderer } from '@busy-office/render-pdf-direct';
import type { DocNode, LayoutIR, PayslipData, PurchaseOrderData } from '@busy-office/output-schema';
import { payslipPdfDirectTemplate, purchaseOrderPdfDirectTemplate } from './templates.js';

const renderer = new PdfDirectRenderer();

export function toLayoutIR(root: DocNode, data: PayslipData | PurchaseOrderData): LayoutIR {
  return { irVersion: '1.0.0', root, data };
}

export async function renderPayslip(data: PayslipData, root: DocNode = payslipPdfDirectTemplate) {
  return renderer.render({ kind: 'ir', ir: toLayoutIR(root, data) });
}

export async function renderPurchaseOrder(data: PurchaseOrderData, root: DocNode = purchaseOrderPdfDirectTemplate) {
  return renderer.render({ kind: 'ir', ir: toLayoutIR(root, data) });
}

export { renderer };
