import { TypstRenderer } from '@busy-office/render-typst';
import type { LayoutIR, PayslipData } from '@busy-office/output-schema';
import { payslipTemplate } from './template.js';

const renderer = new TypstRenderer();

export function toLayoutIR(data: PayslipData): LayoutIR {
  return { irVersion: '1.0.0', root: payslipTemplate, data };
}

export async function renderPayslip(data: PayslipData) {
  return renderer.render({ kind: 'ir', ir: toLayoutIR(data) });
}

export { renderer };
