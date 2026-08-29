/**
 * Log-scrub test (ROADMAP Stage 4 "Payslip: compact template + PII
 * posture" — DoD: "log-scrub test proves no payload fields in logs").
 *
 * This does NOT inspect source code for the absence of logging calls (that
 * inspection is cheap to fool — a payload could reach `console.*` through
 * an indirect path, a future change, or a dependency). Instead it drives a
 * REAL payslip event through the REAL pipeline (contract validation ->
 * determination -> `createOutput().submitEvent` -> composition (render +
 * archive) -> delivery drain) with `console.log`/`console.error`/
 * `console.warn` intercepted via `vi.spyOn`, capturing every argument the
 * way Node's console actually renders it (`util.format`, so an object
 * argument like the poison-alert payload is stringified exactly as a
 * human reading the terminal would see it — not just checked by
 * reference). It then greps every captured line, byte-for-byte, for the
 * literal presence of this test's own real PII values (employee name,
 * employee id, payslip number, and every money amount in the payload).
 * If any log statement anywhere in the pipeline were changed to
 * interpolate the payload (e.g. an error handler that does
 * `JSON.stringify(payload)` or `${err} ${data}`), this test fails.
 *
 * Two scenarios are exercised because a payload-free pipeline that never
 * logs anything would pass this check vacuously:
 *  1. happy path — submit, render, archive, and successfully deliver a
 *     payslip. Proves the common path never leaks PII (it currently emits
 *     no console output at all — see packages/runtime/src/render/
 *     template-content.ts's neighbors and CLAUDE.md's discipline).
 *  2. poison path — a delivery channel that always fails drives the job
 *     to `poison` and fires the real `onPoisonAlert` default
 *     (`sqlite-delivery-queue.ts`'s `console.error('[delivery-queue]
 *     ALERT poison', alert)`), so at least one real, non-mocked log line
 *     IS captured — proving the capture mechanism actually intercepts
 *     real output, not just trivially passing on an empty capture buffer.
 *     `alert` is structured (jobId/docId/channel/attemptCount only, per
 *     `PoisonAlert`) and must still contain none of the PII values.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeDeps, type RuntimeDeps } from '../index.js';
import { createSqliteDeliveryQueue } from '../delivery/sqlite-delivery-queue.js';
import type { ChannelSendInput, ChannelSender } from '../delivery/channel-sender.js';
import { drainOnce } from '../worker.js';
import { createOutput, type OutputPort } from './create-output.js';
import { generatePayslip, generatePayslipRouting, type PayslipRouting } from '../../../../test/corpus/payslip/generate.js';
import type { PayslipData } from '@busy-office/output-schema';
import { TypstRenderer } from '@busy-office/render-typst';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function buildOutput(deps: Pick<RuntimeDeps, 'registryStore' | 'archiveStore' | 'deliveryQueue' | 'composition'>): OutputPort {
  return createOutput({
    registryStore: deps.registryStore,
    archiveStore: deps.archiveStore,
    deliveryQueue: deps.deliveryQueue,
    renderer: deps.composition.renderer,
  });
}

/** Every literal PII value this test's own payload carries, PLUS the
 * employee's mailbox (caller-supplied determination context, Stage 4
 * clause 2 — the bench's `emp-<id>@example.com` pattern; never on the
 * payload, but it flows through determination -> delivery_queue ->
 * channel sender, so it must be scrubbed like payload PII). Every captured
 * log line is checked for the literal presence of each of these. */
function piiNeedles(data: PayslipData, routing: PayslipRouting): string[] {
  return [
    ...routing.recipients,
    data.header.employeeName,
    data.header.employeeId,
    data.header.payslipNumber,
    String(data.totals.grossPay.amount),
    String(data.totals.totalDeductions.amount),
    String(data.totals.netPay.amount),
    ...data.lines.map((l) => String(l.amount.amount)),
  ];
}

/** Spies on console.log/error/warn, capturing each call the way Node's
 * real console renders it (util.format over the raw args — same as what
 * would land in a terminal or a log file), without ever writing to the
 * real stdout/stderr. Returns the captured lines and a restore function. */
function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spies = [
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    }),
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    }),
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    }),
  ];
  return {
    lines,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

function assertNoPiiLeak(lines: string[], data: PayslipData, routing: PayslipRouting): void {
  const needles = piiNeedles(data, routing);
  for (const line of lines) {
    for (const needle of needles) {
      expect(line, `log line unexpectedly contains a PII value ("${needle}"): ${line}`).not.toContain(needle);
    }
  }
}

describe('payslip log-scrub: no payload fields in logs (ROADMAP Stage 4)', () => {
  it('happy path — submit, render, archive, and deliver a real payslip event with console intercepted; no captured log line contains any real PII value', async () => {
    const dbPath = join(tempDir('payslip-scrub-db-'), 'registry.db');
    const deps = createRuntimeDeps(dbPath, tempDir('payslip-scrub-archive-'), tempDir('payslip-scrub-outbox-'));
    const output = buildOutput(deps);

    const data = generatePayslip({ seed: 42, earningCount: 2, deductionCount: 2 });
    const routing = generatePayslipRouting(42);

    const capture = captureConsole();
    try {
      const result = await output.submitEvent({
        documentType: 'payslip',
        payload: data,
        businessEvent: {
          businessObject: 'PAYROLL',
          businessObjectId: 'PS-SCRUB-0001',
          event: 'payslip.issued',
          templateVersion: '1.0.0',
        },
        determination: { locale: routing.locale, country: routing.country, recipients: routing.recipients },
      });
      expect(result.status).toBe('accepted');
      if (result.status !== 'accepted') throw new Error('unreachable');
      expect(result.resolutions).toHaveLength(1);
      expect(result.resolutions[0].composition).toMatchObject({ outcome: 'rendered' });

      // Drive the real delivery worker step (FsChannelSender — succeeds,
      // writes the archived bytes to disk, never to a log line).
      const deliveryResults = await drainOnce(deps.deliveryQueue, deps.channelSender);
      expect(deliveryResults).toHaveLength(1);
      expect(deliveryResults[0].outcome).toBe('delivered');
    } finally {
      capture.restore();
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }

    assertNoPiiLeak(capture.lines, data, routing);
  }, 30_000);

  it('poison path — a permanently-failing delivery channel drives the job to poison and fires the real console.error alert; the alert line is captured (proving the mechanism works) but carries no PII value', async () => {
    const dbPath = join(tempDir('payslip-poison-db-'), 'registry.db');
    const archiveDir = tempDir('payslip-poison-archive-');
    const baseDeps = createRuntimeDeps(dbPath, archiveDir, tempDir('payslip-poison-outbox-'));
    baseDeps.deliveryQueue.close();
    const { registryStore, archiveStore } = baseDeps;
    // Rebuild just the delivery queue by hand so it can use a fast backoff
    // policy (poison after the very first failure) while keeping the
    // DEFAULT onPoisonAlert (the real `console.error('[delivery-queue]
    // ALERT poison', alert)` line this test is proving is payload-free —
    // not a test double standing in for it).
    const deliveryQueue = createSqliteDeliveryQueue(dbPath, {
      registryStore,
      archiveStore,
      backoffPolicy: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    const renderer = new TypstRenderer();
    const output = createOutput({ registryStore, archiveStore, deliveryQueue, renderer });

    const failingSender: ChannelSender = {
      async send(_input: ChannelSendInput): Promise<void> {
        // A realistic, PII-free failure — the same shape a real channel
        // outage would produce (never interpolates the send input).
        throw new Error('ECONNREFUSED: mail relay unreachable');
      },
    };

    const data = generatePayslip({ seed: 99, earningCount: 1, deductionCount: 1 });
    const routing = generatePayslipRouting(99);

    const capture = captureConsole();
    try {
      const result = await output.submitEvent({
        documentType: 'payslip',
        payload: data,
        businessEvent: {
          businessObject: 'PAYROLL',
          businessObjectId: 'PS-SCRUB-0002',
          event: 'payslip.issued',
          templateVersion: '1.0.0',
        },
        determination: { locale: routing.locale, country: routing.country, recipients: routing.recipients },
      });
      expect(result.status).toBe('accepted');
      if (result.status !== 'accepted') throw new Error('unreachable');
      const docId = result.resolutions[0].docId;

      const deliveryResults = await drainOnce(deliveryQueue, failingSender);
      expect(deliveryResults).toHaveLength(1);
      expect(deliveryResults[0].outcome).toBe('poisoned');
      expect(deliveryResults[0].job.docId).toBe(docId);

      // Sanity: the capture mechanism really did intercept a real
      // console.error call — this test has teeth, it isn't vacuously
      // passing on an empty capture buffer.
      expect(capture.lines.some((l) => l.includes('[delivery-queue] ALERT poison'))).toBe(true);
      expect(capture.lines.some((l) => l.includes(docId))).toBe(true);
    } finally {
      capture.restore();
      deliveryQueue.close();
      registryStore.close();
    }

    assertNoPiiLeak(capture.lines, data, routing);
  }, 30_000);
});
