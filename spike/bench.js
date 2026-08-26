/**
 * Shared timing harness. Usage:
 *   const { bench } = require('../bench');
 *   await bench('carbone-pdf', async () => { ...render one document... }, { runs: 30, warmup: 3 });
 * Reports p50 / p95 / mean ms per document — the number the Stage 0 gate needs.
 */
async function bench(name, fn, { runs = 30, warmup = 3 } = {}) {
  for (let i = 0; i < warmup; i++) await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const line = `${name}: p50=${p(0.5).toFixed(1)}ms p95=${p(0.95).toFixed(1)}ms mean=${mean.toFixed(1)}ms (n=${runs})`;
  console.log(line);
  return { name, p50: p(0.5), p95: p(0.95), mean, runs, line };
}
module.exports = { bench };
