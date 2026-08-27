/**
 * ROADMAP Stage 2 "ms/doc published in README" bench. Reuses the existing
 * corpus harness (render.ts/generate.ts) rather than a separate bench
 * setup — same TypstRenderer, same DocNode tree, same generator every other
 * corpus test uses. Run standalone: `npm run bench:po`.
 *
 * Measures the 001-single-page corpus case warm (a few untimed warmup
 * renders first, since the first `typst compile` in a process pays extra
 * OS/font-cache cost — this is an in-process Node measurement of repeated
 * `typst compile` shell-outs, NOT the pdf-direct in-process p50 from
 * docs/RESULTS.md; those numbers are not comparable and this script does
 * not claim they are).
 */
import { CORPUS_CASES, generatePurchaseOrder } from './generate.js';
import { renderPurchaseOrder } from './render.js';

const WARMUP_RUNS = 3;
const TIMED_RUNS = 20;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main(): Promise<void> {
  const data = generatePurchaseOrder(CORPUS_CASES['001-single-page']);

  for (let i = 0; i < WARMUP_RUNS; i++) {
    await renderPurchaseOrder(data);
  }

  const durationsMs: number[] = [];
  for (let i = 0; i < TIMED_RUNS; i++) {
    const start = performance.now();
    await renderPurchaseOrder(data);
    durationsMs.push(performance.now() - start);
  }

  const sorted = [...durationsMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const mean = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;

  console.log(`purchase-order 001-single-page, typst renderer, n=${TIMED_RUNS} (warmup=${WARMUP_RUNS})`);
  console.log(`p50: ${p50.toFixed(1)}ms  p95: ${p95.toFixed(1)}ms  mean: ${mean.toFixed(1)}ms`);
  console.log(`raw (ms): ${sorted.map((d) => d.toFixed(1)).join(', ')}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
