/**
 * Stage 4 exit gate, clause 2 — "per-recipient locale and channel" — as a
 * PERMANENT, row-based gate inside `npm test` (the 8,000-doc run is the
 * same pipeline at scale: test/bench/bursting.ts, recorded in
 * docs/RESULTS.md).
 *
 * N distinct payslip events go through the REAL pipeline
 * (`createOutput().emit` over `createRuntimeDeps` on disk: real
 * rules under packages/runtime/rules/ via document-types/, real TypstRenderer, SQLite
 * registry + delivery queue), each carrying its OWN employee's locale,
 * country, and mailbox as caller-supplied determination context
 * (`generatePayslipRouting` — seeded, never hand-edited). The assertions
 * then read what is DURABLY ON DISK — `document_registry.locale`
 * (migrations/0010) JOIN `delivery_queue` (channel, recipients) — via
 * `summarizeRouting`, not the in-process return values:
 *   - >= 2 locales, and both channels each with a meaningful share;
 *   - registry rows == N + fan-out copies (the `payslip-country-DE-archive-
 *     copy` rule fires for every DE employee: one extra object-store row);
 *   - every email delivery goes to a DISTINCT recipient (its own doc's);
 *   - one persisted trace per event on the embedded path (the trace used
 *     to be dropped here — HLD §9 makes it mandatory).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeDeps } from '../index.js';
import { createOutput } from './create-output.js';
import { generatePayslip, generatePayslipRouting, ROUTING_LOCALES } from '../../../../test/corpus/payslip/generate.js';
import { summarizeRouting } from '../../../../test/bench/routing-breakdown.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

/** Small enough for `npm test` (~140 ms/doc render), large enough that
 * every locale x country cell is populated several times over. */
const N = 24;

describe('per-recipient locale and channel — row-based gate (ROADMAP Stage 4 exit gate clause 2)', () => {
  it(`routes ${N} payslip events each to its own recipient/locale/channel, verifiable from registry rows`, async () => {
    const root = tempDir('per-recipient-');
    const dbPath = join(root, 'registry.db');
    const deps = createRuntimeDeps(dbPath, join(root, 'archive'), join(root, 'outbox'));
    const output = createOutput({
      registryStore: deps.registryStore,
      archiveStore: deps.archiveStore,
      deliveryQueue: deps.deliveryQueue,
      renderer: deps.composition.renderer,
      documentTypes: deps.documentTypes,
    });

    let expectedFanOutCopies = 0;
    const expectedEmailRecipients = new Set<string>();
    try {
      for (let i = 0; i < N; i++) {
        const seed = 500_000 + i;
        const routing = generatePayslipRouting(seed);
        if (routing.country === 'DE') expectedFanOutCopies += 1;
        expectedEmailRecipients.add(routing.recipients[0]);
        const result = await output.emit({
          documentType: 'payslip',
          payload: generatePayslip({ seed, earningCount: 1 + (i % 3), deductionCount: 1 + (i % 2) }),
          businessEvent: {
            businessObject: 'PAYROLL',
            businessObjectId: `EMP-${String(seed).padStart(7, '0')}`,
            event: 'payslip.issued',
            templateVersion: '1.0.0',
          },
          determination: { locale: routing.locale, country: routing.country, recipients: routing.recipients },
        });
        expect(result.status).toBe('accepted');
        if (result.status !== 'accepted') throw new Error('unreachable');
        // Each doc lands on the channel/recipient/locale ITS OWN event named.
        const email = result.resolutions.find((r) => r.channel === 'email');
        expect(email).toMatchObject({ ruleId: 'payslip-default-email', recipients: routing.recipients, locale: routing.locale });
        expect(email?.composition).toMatchObject({ outcome: 'rendered' });
        const copies = result.resolutions.filter((r) => r.channel === 'object-store');
        expect(copies).toHaveLength(routing.country === 'DE' ? 1 : 0);
        if (copies.length === 1) {
          // Rule wins when it names recipients (fan-out "also archive a copy").
          expect(copies[0]).toMatchObject({ ruleId: 'payslip-country-DE-archive-copy', recipients: ['archive://payroll/de'], locale: routing.locale });
        }
        // The persisted trace exists for THIS event, and carries no address.
        const trace = deps.registryStore.getTraceLog(result.resolutions[0].docId);
        expect(trace?.outcome).toBe('matched');
        expect(JSON.stringify(trace)).not.toContain(routing.recipients[0]);
        // The registry row carries the locale the event named.
        expect(deps.registryStore.getByDocId(email!.docId)?.locale).toBe(routing.locale);
      }
    } finally {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    }

    expect(expectedFanOutCopies).toBeGreaterThan(0);
    expect(expectedEmailRecipients.size).toBe(N);

    // ---- Row-based assertion, straight from the SQLite file ----
    const summary = summarizeRouting(dbPath);
    const locales = new Set(summary.cells.map((c) => c.locale));
    const channels = new Set(summary.cells.map((c) => c.channel));
    const rowsByChannel = (ch: string) => summary.cells.filter((c) => c.channel === ch).reduce((a, c) => a + c.rows, 0);

    expect(summary.registryRows).toBe(N + expectedFanOutCopies);
    expect(summary.deliveryJobs).toBe(N + expectedFanOutCopies);
    expect(summary.traceRows).toBe(N);
    expect(locales.size).toBeGreaterThanOrEqual(2);
    for (const locale of ROUTING_LOCALES) expect(locales.has(locale)).toBe(true);
    expect(locales.has(null)).toBe(false);
    expect(channels).toEqual(new Set(['email', 'object-store']));
    expect(rowsByChannel('email')).toBe(N);
    expect(rowsByChannel('object-store')).toBe(expectedFanOutCopies);
    // "Meaningful share": the object-store copies are >= 20% of docs, and
    // every locale has rows on BOTH channels.
    expect(expectedFanOutCopies / N).toBeGreaterThanOrEqual(0.2);
    for (const locale of ROUTING_LOCALES) {
      expect(summary.cells.find((c) => c.locale === locale && c.channel === 'email')?.rows).toBeGreaterThan(0);
      expect(summary.cells.find((c) => c.locale === locale && c.channel === 'object-store')?.rows).toBeGreaterThan(0);
    }
    // Recipients distinct per doc on the email channel (the per-employee
    // mailbox); the archive copies deliberately share one destination.
    expect(summary.emailJobs).toBe(N);
    expect(summary.distinctEmailRecipients).toBe(N);
    for (const cell of summary.cells) {
      if (cell.channel === 'email') expect(cell.distinctRecipients).toBe(cell.rows);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[per-recipient gate] N=${N} rows=${summary.registryRows} traces=${summary.traceRows} ` +
        summary.cells.map((c) => `${c.locale}/${c.channel}=${c.rows}(distinct ${c.distinctRecipients})`).join(' '),
    );
  }, 120_000);
});
