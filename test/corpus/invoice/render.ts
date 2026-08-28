import { TypstRenderer } from '@busy-office/render-typst';
import type { InvoiceData, LayoutIR } from '@busy-office/output-schema';
import { invoiceTemplate } from './template.js';

const renderer = new TypstRenderer();

export function toLayoutIR(data: InvoiceData): LayoutIR {
  return { irVersion: '1.0.0', root: invoiceTemplate, data };
}

export async function renderInvoice(data: InvoiceData) {
  return renderer.render({ kind: 'ir', ir: toLayoutIR(data) });
}

export { renderer };
