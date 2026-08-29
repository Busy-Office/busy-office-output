/**
 * ms/doc for the pdf-direct renderer (ROADMAP Stage 4 "pdf-direct second
 * renderer"; README bench table row). Same shape as
 * test/corpus/purchase-order/bench.ts — warm, n=20 timed after 3 untimed
 * warmups, p50/p95/mean — measured on the payslip 001-single-page shape
 * (the document type ADR-002 kept this renderer for) AND on the
 * purchase-order 001-single-page shape so there is a row directly
 * comparable to the existing Typst row (same document type, same corpus
 * case, same data). This is an in-process pdf-lib measurement; the Typst
 * row is a shell-out to `typst compile`. Both are what a caller of
 * `Renderer.render()` waits for, which is the number that matters for
 * bursting, but they are not the same kind of work. Run: `npm run
 * bench:pdf-direct`.
 */
import { CORPUS_CASES as PAYSLIP_CASES, generatePayslip } from '../payslip/generate.js';
import { CORPUS_CASES as PO_CASES, generatePurchaseOrder } from '../purchase-order/generate.js';
import { renderPayslip, renderPurchaseOrder } from './render.js';

const WARMUP_RUNS = 3;
const TIMED_RUNS = 20;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function bench(label: string, render: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < WARMUP_RUNS; i++) await render();
  const durationsMs: number[] = [];
  for (let i = 0; i < TIMED_RUNS; i++) {
    const start = performance.now();
    await render();
    durationsMs.push(performance.now() - start);
  }
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const mean = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
  console.log(`${label}, pdf-direct renderer, n=${TIMED_RUNS} (warmup=${WARMUP_RUNS})`);
  console.log(`p50: ${percentile(sorted, 50).toFixed(1)}ms  p95: ${percentile(sorted, 95).toFixed(1)}ms  mean: ${mean.toFixed(1)}ms`);
  console.log(`raw (ms): ${sorted.map((d) => d.toFixed(1)).join(', ')}`);
}

async function main(): Promise<void> {
  const payslip = generatePayslip(PAYSLIP_CASES['001-single-page']);
  const po = generatePurchaseOrder(PO_CASES['001-single-page']);
  await bench('payslip 001-single-page', () => renderPayslip(payslip));
  await bench('purchase-order 001-single-page', () => renderPurchaseOrder(po));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
