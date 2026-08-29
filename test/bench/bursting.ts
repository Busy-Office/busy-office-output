/**
 * Bursting bench (ROADMAP Stage 4 / GAP-03): N distinct payslip events
 * through the REAL pipeline — `createOutput().emit()` against
 * `createRuntimeDeps()` on disk (SQLite registry, FsArchiveStore, real
 * `TypstRenderer`, real SqliteDeliveryQueue enqueue). Per document this
 * exercises: contract validation, determination (rule + template
 * resolution, fan-out), transactional-outbox mint (registry row), Typst
 * render (`typst compile --pdf-standard a-2b` + `typst query` overflow
 * guard), archive (FS write + registry archiveRef/retention), delivery
 * enqueue (pending job row). Delivery DRAIN (FsChannelSender copy to the
 * outbox) is NOT included by default — pass `--drain` to add one
 * `drainOnce()` after the timed loop and report it separately.
 *
 * This is deliberately NOT part of `npm test` (16+ minutes at N=8000).
 * Run: `npm run bench:burst -- --n 200` (validate), `--n 8000` (the real
 * gate number), `--concurrency 4` for the batched-Promise.all variant.
 * Registry/archive/outbox live in a fresh OS temp dir that is deleted on
 * exit unless `--keep` is given — nothing lands under a tracked path.
 *
 * Numbers are recorded in docs/RESULTS.md ("Bursting — real pipeline,
 * Stage 4"). This script measures; it decides nothing about ADR-002.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join } from 'node:path';
import type { Artifact, RenderJob, Renderer } from '@busy-office/output-schema';
import { createRuntimeDeps, createOutput, drainOnce } from '@busy-office/runtime';
import type { ArchiveStore } from '@busy-office/runtime';
import { generatePayslip, generatePayslipRouting } from '../corpus/payslip/generate.js';
import { summarizeRouting } from './routing-breakdown.js';

interface Args {
  n: number;
  concurrency: number;
  warmup: number;
  drain: boolean;
  keep: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { n: 200, concurrency: 1, warmup: 3, drain: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return Number(v);
    };
    if (a === '--n') args.n = next();
    else if (a === '--concurrency') args.concurrency = next();
    else if (a === '--warmup') args.warmup = next();
    else if (a === '--drain') args.drain = true;
    else if (a === '--keep') args.keep = true;
    else throw new Error(`unknown arg ${a}`);
  }
  return args;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function stats(samples: number[]): { mean: number; p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    mean: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** Wrap a Renderer / ArchiveStore so their per-call time is captured —
 * the same object identity semantics otherwise (phase breakdown only). */
function timedRenderer(inner: Renderer, sink: number[]): Renderer {
  return {
    id: inner.id,
    version: inner.version,
    accepts: inner.accepts,
    async render(job: RenderJob): Promise<Artifact> {
      const t = performance.now();
      try {
        return await inner.render(job);
      } finally {
        sink.push(performance.now() - t);
      }
    },
  };
}

function timedArchive(inner: ArchiveStore, sink: number[]): ArchiveStore {
  return {
    ...inner,
    async archive(input) {
      const t = performance.now();
      try {
        return await inner.archive(input);
      } finally {
        sink.push(performance.now() - t);
      }
    },
    retrieve: (ref) => inner.retrieve(ref),
    purge: (ref) => inner.purge(ref),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = mkdtempSync(join(tmpdir(), 'bo-burst-'));
  const deps = createRuntimeDeps(join(root, 'registry.db'), join(root, 'archive'), join(root, 'outbox'));

  const renderMs: number[] = [];
  const archiveMs: number[] = [];
  const output = createOutput({
    registryStore: deps.registryStore,
    archiveStore: timedArchive(deps.archiveStore, archiveMs),
    deliveryQueue: deps.deliveryQueue,
    renderer: timedRenderer(deps.composition.renderer, renderMs),
    documentTypes: deps.documentTypes,
  });

  // Payslip mix: cycle through the realistic 1..4 earning / 1..4 deduction
  // shapes so the corpus isn't one identical document 8,000 times.
  // Per-recipient routing (Stage 4 exit gate clause 2): every event carries
  // its OWN employee's locale, country, and mailbox as caller-supplied
  // determination context (master data — never on the payload, HLD §1);
  // `payslip-default-email` routes to that mailbox, and the fan-out rule
  // `payslip-country-DE-archive-copy` adds an object-store copy for DE.
  const submitOne = async (i: number) => {
    const seed = 100_000 + i;
    const payload = generatePayslip({ seed, earningCount: 1 + (i % 4), deductionCount: 1 + ((i >> 2) % 4) });
    const routing = generatePayslipRouting(seed);
    const t = performance.now();
    const result = await output.emit({
      documentType: 'payslip',
      payload,
      businessEvent: {
        businessObject: 'PAYROLL',
        businessObjectId: `EMP-${String(seed).padStart(7, '0')}`,
        event: 'payslip.issued',
        templateVersion: '1.0.0',
      },
      determination: { locale: routing.locale, country: routing.country, recipients: routing.recipients },
    });
    const ms = performance.now() - t;
    if (result.status !== 'accepted') throw new Error(`doc ${i}: ${result.status}`);
    for (const r of result.resolutions) {
      if (r.replayed || r.composition.outcome !== 'rendered') {
        throw new Error(`doc ${i}: unexpected outcome ${JSON.stringify({ replayed: r.replayed, outcome: r.composition.outcome })}`);
      }
    }
    return { ms, resolutions: result.resolutions.length };
  };

  // Warmup (untimed, distinct ids in a negative range so they never collide).
  for (let w = 0; w < args.warmup; w++) await submitOne(-1 - w);
  renderMs.length = 0;
  archiveMs.length = 0;

  const docMs: number[] = [];
  let resolutions = 0;
  const wallStart = performance.now();
  let lastReport = wallStart;
  for (let i = 0; i < args.n; i += args.concurrency) {
    const batch = Array.from({ length: Math.min(args.concurrency, args.n - i) }, (_, k) => submitOne(i + k));
    for (const r of await Promise.all(batch)) {
      docMs.push(r.ms);
      resolutions += r.resolutions;
    }
    const now = performance.now();
    if (now - lastReport > 30_000) {
      const done = i + batch.length;
      const elapsed = (now - wallStart) / 1000;
      process.stderr.write(`  ${done}/${args.n} docs, ${elapsed.toFixed(0)}s elapsed, ${((elapsed / done) * 1000).toFixed(1)} ms/doc wall, projected total ${((elapsed / done) * args.n / 60).toFixed(1)} min\n`);
      lastReport = now;
    }
  }
  const wallMs = performance.now() - wallStart;

  let drainMs: number | undefined;
  let drained = 0;
  if (args.drain) {
    const t = performance.now();
    const results = await drainOnce(deps.deliveryQueue, deps.channelSender);
    drainMs = performance.now() - t;
    drained = results.length;
  }

  // Row-based locale x channel breakdown straight from SQLite (the same
  // query the permanent gate test asserts on at small N) — read BEFORE the
  // handles close and the temp dir goes away.
  const routing = summarizeRouting(join(root, 'registry.db'));

  deps.deliveryQueue.close();
  deps.registryStore.close();

  const d = stats(docMs);
  const r = stats(renderMs);
  const a = stats(archiveMs);
  const wallPerDoc = wallMs / args.n;
  const projected8000Min = (wallPerDoc * 8000) / 60_000;
  const windowMin = 30;
  const lines = [
    `bursting bench — payslip, typst renderer, real pipeline (validate+determine+mint+render+archive+enqueue)`,
    `machine: ${cpus()[0]?.model ?? 'unknown'} x${cpus().length}, ${(totalmem() / 2 ** 30).toFixed(0)} GB, darwin ${release()}, node ${process.version}`,
    `N=${args.n} concurrency=${args.concurrency} warmup=${args.warmup} resolutions=${resolutions} drain=${args.drain ? 'included-after-loop' : 'excluded'}`,
    `total wall-clock: ${(wallMs / 1000).toFixed(1)}s (${(wallMs / 60_000).toFixed(2)} min)`,
    `wall ms/doc (wall/N): ${wallPerDoc.toFixed(1)}ms`,
    `per-doc emit latency: mean ${d.mean.toFixed(1)}ms  p50 ${d.p50.toFixed(1)}ms  p95 ${d.p95.toFixed(1)}ms  max ${d.max.toFixed(1)}ms`,
    `  render phase (typst compile+query): mean ${r.mean.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  (n=${renderMs.length})`,
    `  archive phase (fs write):           mean ${a.mean.toFixed(1)}ms  p50 ${a.p50.toFixed(1)}ms  p95 ${a.p95.toFixed(1)}ms  (n=${archiveMs.length})`,
    // Per DOC, not per render: a fan-out event renders once per resolution
    // (the DE archive copy), so render/archive sums are divided by N here.
    `  everything else (validate/determine/mint/enqueue): mean ${(d.mean - renderMs.reduce((x, y) => x + y, 0) / args.n - archiveMs.reduce((x, y) => x + y, 0) / args.n).toFixed(1)}ms per doc (renders per doc: ${(renderMs.length / args.n).toFixed(2)})`,
    `projection: 8,000 docs at this wall ms/doc = ${projected8000Min.toFixed(1)} min vs ${windowMin}-min window -> margin ${(windowMin / projected8000Min).toFixed(2)}x${args.n === 8000 ? ' (measured, not projected)' : ' (PROJECTED from N=' + args.n + ')'}`,
  ];
  if (drainMs !== undefined) lines.push(`drain (FsChannelSender): ${drained} jobs in ${(drainMs / 1000).toFixed(1)}s = ${(drainMs / Math.max(1, drained)).toFixed(1)} ms/job`);
  lines.push(`per-recipient routing (document_registry JOIN delivery_queue, incl. ${args.warmup} warmup docs):`);
  for (const cell of routing.cells) {
    lines.push(`  locale=${cell.locale ?? '(null)'} channel=${cell.channel} rows=${cell.rows} distinctRecipients=${cell.distinctRecipients}`);
  }
  lines.push(`  registry rows=${routing.registryRows} delivery jobs=${routing.deliveryJobs} traces=${routing.traceRows} docs with a distinct email recipient=${routing.distinctEmailRecipients}`);
  console.log(lines.join('\n'));

  if (args.keep) console.log(`kept: ${root}`);
  else rmSync(root, { recursive: true, force: true });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
