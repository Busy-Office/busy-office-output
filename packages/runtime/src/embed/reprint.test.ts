/**
 * Three-path reprint test (ROADMAP Stage 5 task 2 — DoD: "three-path test
 * with stamped outputs"; arb-chair ruling 2026-08-29, ADR-007 v1.1).
 *
 * Real `createOutput` + SQLite registry + `FsArchiveStore` + real Typst
 * renderer. Setup: emit ONE payslip for owner E1 -> docId A, ORIGINAL.
 *
 *  1. reproduce  — bytes byte-equal to the archive; row A untouched
 *                  (ORIGINAL, updatedAt unchanged); ONE reprint_log row;
 *                  registry count unchanged; after retention purge -> `purged`.
 *  2. regenerate — NEW docId B, state REPRINT, own archiveRef + delivery
 *                  job; A and its bytes untouched; reprint_log links A -> B;
 *                  a SECOND regenerate mints C != B (non-idempotent).
 *  3. reissue    — `emit` with a NEW event key + `reissues`: docId D,
 *                  ORIGINAL, replayed:false; reprint_log links A -> D.
 *  4. authz      — employee E2 forbidden on all three with NOTHING written
 *                  (no log row, no registry row, no archive read); E1 and
 *                  hr-clerk allowed; a purchase-order row default-allows;
 *                  missing subjectId -> actor-required; blank reason ->
 *                  reason-required.
 *  5. log-scrub  — 1–3 with console intercepted exactly as
 *                  payslip-log-scrub.test.ts does; no PII value in any line.
 *
 * The "stamp" asserted throughout is METADATA — the reprint_log row —
 * never a modification of archived bytes (which are proven byte-identical
 * before and after every path).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PayslipData } from '@busy-office/output-schema';
import { createRuntimeDeps, type RuntimeDeps } from '../index.js';
import { enforceRetention } from '../archive/retention-enforcement.js';
import type { DocumentRegistryRow } from '../registry/registry-store.js';
import type { Actor } from '../authorization/authorization-port.js';
import { validPurchaseOrder } from '../fixtures.js';
import { generatePayslip, generatePayslipRouting, type PayslipRouting } from '../../../../test/corpus/payslip/generate.js';
import type { OutputPort } from './create-output.js';

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

const CLERK: Actor = { role: 'hr-clerk', subjectId: 'clerk-1' };

interface Fixture {
  deps: RuntimeDeps;
  output: OutputPort;
  data: PayslipData;
  routing: PayslipRouting;
  /** Owner E1 — the payslip's `header.employeeId`. */
  e1: Actor;
  /** Another employee, NOT the owner. */
  e2: Actor;
  docA: string;
  rowA: DocumentRegistryRow;
  bytesA: Uint8Array;
  close(): void;
}

/** Emit one payslip (owner E1) -> docId A, ORIGINAL, archived. */
async function setup(seed: number, objectId: string): Promise<Fixture> {
  const deps = createRuntimeDeps(
    join(tempDir('reprint-db-'), 'registry.db'),
    tempDir('reprint-archive-'),
    tempDir('reprint-outbox-'),
  );
  const output = deps.output;
  const data = generatePayslip({ seed, earningCount: 2, deductionCount: 1 });
  const routing = generatePayslipRouting(seed);

  const result = await output.emit({
    documentType: 'payslip',
    payload: data,
    businessEvent: { businessObject: 'PAYROLL', businessObjectId: objectId, event: 'payslip.issued', templateVersion: '1.0.0' },
    determination: { locale: routing.locale, country: routing.country, recipients: routing.recipients },
  });
  expect(result.status).toBe('accepted');
  if (result.status !== 'accepted') throw new Error('unreachable');
  // The email resolution is the primary one for every seed; the DE fan-out
  // sibling (object-store) may also exist — pick the email row.
  const primary = result.resolutions.find((r) => r.ruleId === 'payslip-default-email');
  expect(primary).toBeDefined();
  expect(primary!.composition).toMatchObject({ outcome: 'rendered' });
  const docA = primary!.docId;
  const rowA = deps.registryStore.getByDocId(docA)!;
  expect(rowA.state).toBe('ORIGINAL');
  expect(rowA.archiveRef).not.toBeNull();
  expect(rowA.ownerId).toBe(data.header.employeeId);
  const bytesA = await deps.archiveStore.retrieve(rowA.archiveRef!);

  return {
    deps,
    output,
    data,
    routing,
    e1: { role: 'employee', subjectId: data.header.employeeId },
    e2: { role: 'employee', subjectId: `${data.header.employeeId}-someone-else` },
    docA,
    rowA,
    bytesA,
    close: () => {
      deps.deliveryQueue.close();
      deps.registryStore.close();
    },
  };
}

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spies = (['log', 'error', 'warn'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    }),
  );
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}

function piiNeedles(data: PayslipData, routing: PayslipRouting, rendered: string[]): string[] {
  return [
    ...rendered,
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

describe('reprint path 1 — reproduce = archive fetch, stamped as metadata', () => {
  it('returns the archived bytes byte-identical, leaves row A untouched, writes ONE reprint_log row; after purge -> purged', async () => {
    const f = await setup(42, 'PS-REPRINT-0001');
    try {
      const before = f.deps.registryStore.listDocuments().length;

      const result = await f.output.reproduce({ docId: f.docA, actor: CLERK, reason: 'audit request' });
      expect(result.status).toBe('reproduced');
      if (result.status !== 'reproduced') throw new Error('unreachable');

      // Byte-identical to what the archive holds — nothing stamped INTO the bytes.
      const archived = await f.deps.archiveStore.retrieve(f.rowA.archiveRef!);
      expect(Buffer.from(result.bytes).equals(Buffer.from(archived))).toBe(true);
      expect(Buffer.from(result.bytes).equals(Buffer.from(f.bytesA))).toBe(true);
      // mediaType was READ back off the FS sidecar, not assumed.
      expect(result.mediaType).toBe('application/pdf');

      // Row A: untouched.
      const rowAfter = f.deps.registryStore.getByDocId(f.docA)!;
      expect(rowAfter.state).toBe('ORIGINAL');
      expect(rowAfter.updatedAt).toBe(f.rowA.updatedAt);
      expect(rowAfter.archiveRef).toBe(f.rowA.archiveRef);
      expect(f.deps.registryStore.listDocuments().length).toBe(before);

      // The stamp: exactly one reprint_log row.
      const log = f.deps.registryStore.listReprintLog(f.docA);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        id: result.reprintLogId,
        docId: f.docA,
        action: 'reproduce',
        resultDocId: null,
        actorRole: 'hr-clerk',
        actorSubjectId: 'clerk-1',
        reason: 'audit request',
      });
      expect(Date.parse(log[0].occurredAt)).not.toBeNaN();

      // Retention past A's deadline purges the bytes; reproduce says so.
      const purged = await enforceRetention(
        { registryStore: f.deps.registryStore, archiveStore: f.deps.archiveStore },
        '2999-01-01T00:00:00.000Z',
      );
      expect(purged.some((p) => p.docId === f.docA && p.outcome === 'purged')).toBe(true);
      const afterPurge = await f.output.reproduce({ docId: f.docA, actor: CLERK, reason: 'audit request' });
      const purgedRow = f.deps.registryStore.getByDocId(f.docA)!;
      expect(afterPurge).toEqual({ status: 'purged', docId: f.docA, purgedAt: purgedRow.purgedAt });
      // A refusal stamps nothing.
      expect(f.deps.registryStore.listReprintLog(f.docA)).toHaveLength(1);
    } finally {
      f.close();
    }
  }, 30_000);

  it('a row that was never archived (DRAFT) is not-archived, not purged', async () => {
    const f = await setup(7, 'PS-REPRINT-0002');
    try {
      const draft = f.deps.registryStore.getOrCreateByEventKey(
        { businessObject: 'PAYROLL', businessObjectId: 'PS-DRAFT', event: 'payslip.issued', templateVersion: '1.0.0' },
        'payslip',
        f.data.header.employeeId,
      ).row;
      expect(draft.state).toBe('DRAFT');
      const result = await f.output.reproduce({ docId: draft.docId, actor: CLERK, reason: 'audit request' });
      expect(result).toEqual({ status: 'not-archived', docId: draft.docId });
      expect(f.deps.registryStore.listReprintLog(draft.docId)).toEqual([]);
    } finally {
      f.close();
    }
  }, 30_000);
});

describe('reprint path 2 — regenerate = NEW document from current template + caller data, state REPRINT', () => {
  it('mints B != A as REPRINT with its own archive + delivery job; A untouched and byte-identical; a second regenerate mints C != B', async () => {
    const f = await setup(42, 'PS-REPRINT-0003');
    try {
      const before = f.deps.registryStore.listDocuments().length;

      const result = await f.output.regenerate({
        docId: f.docA,
        actor: CLERK,
        reason: 'reprint for employee',
        payload: f.data,
        determination: { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients },
      });
      expect(result.status).toBe('regenerated');
      if (result.status !== 'regenerated') throw new Error('unreachable');
      expect(result.originalDocId).toBe(f.docA);
      expect(result.docId).not.toBe(f.docA);
      expect(result.state).toBe('REPRINT');
      expect(result.composition).toMatchObject({ outcome: 'rendered' });
      if (result.composition?.outcome !== 'rendered') throw new Error('unreachable');
      expect(result.trace.firingRuleIds).toContain('payslip-default-email');

      // Row B: REPRINT, own archiveRef, own delivery job, distinguished key.
      const rowB = f.deps.registryStore.getByDocId(result.docId)!;
      expect(rowB.state).toBe('REPRINT');
      expect(rowB.archiveRef).not.toBeNull();
      expect(rowB.archiveRef).not.toBe(f.rowA.archiveRef);
      expect(rowB.archiveRef).toBe(result.composition.archiveRef);
      expect(rowB.rendererVersion).not.toBeNull();
      expect(rowB.retentionUntil).not.toBeNull();
      expect(rowB.ownerId).toBe(f.data.header.employeeId);
      expect(rowB.ruleId.startsWith(`regenerate:${f.docA}:`)).toBe(true);
      expect(rowB.businessObjectId).toBe(f.rowA.businessObjectId);
      const jobB = f.deps.deliveryQueue.getJob(result.composition.deliveryJobId);
      expect(jobB?.docId).toBe(result.docId);
      expect(f.deps.registryStore.listDocuments().length).toBe(before + 1);

      // Row A: untouched; bytes byte-identical before/after.
      const rowAfter = f.deps.registryStore.getByDocId(f.docA)!;
      expect(rowAfter.state).toBe('ORIGINAL');
      expect(rowAfter.updatedAt).toBe(f.rowA.updatedAt);
      expect(rowAfter.archiveRef).toBe(f.rowA.archiveRef);
      const bytesAAfter = await f.deps.archiveStore.retrieve(f.rowA.archiveRef!);
      expect(Buffer.from(bytesAAfter).equals(Buffer.from(f.bytesA))).toBe(true);

      // The link lives in reprint_log, not in a registry column.
      expect(f.deps.registryStore.listReprintLog(f.docA)).toMatchObject([
        { docId: f.docA, action: 'regenerate', resultDocId: result.docId, actorRole: 'hr-clerk', actorSubjectId: 'clerk-1', reason: 'reprint for employee' },
      ]);
      expect(f.deps.registryStore.listReprintLog(result.docId)).toEqual([]);

      // Non-idempotent by definition: a second regenerate mints a THIRD row.
      const second = await f.output.regenerate({
        docId: f.docA,
        actor: CLERK,
        reason: 'reprint for employee',
        payload: f.data,
        determination: { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients },
      });
      expect(second.status).toBe('regenerated');
      if (second.status !== 'regenerated') throw new Error('unreachable');
      expect(second.docId).not.toBe(result.docId);
      expect(second.docId).not.toBe(f.docA);
      expect(f.deps.registryStore.getByDocId(second.docId)!.state).toBe('REPRINT');
      expect(f.deps.registryStore.listDocuments().length).toBe(before + 2);
      expect(f.deps.registryStore.listReprintLog(f.docA).map((e) => e.resultDocId)).toEqual([result.docId, second.docId]);
    } finally {
      f.close();
    }
  }, 60_000);

  it('a payload that fails the contract is invalid-contract and mints nothing', async () => {
    const f = await setup(42, 'PS-REPRINT-0004');
    try {
      const before = f.deps.registryStore.listDocuments().length;
      const result = await f.output.regenerate({ docId: f.docA, actor: CLERK, reason: 'r', payload: { documentType: 'payslip' } });
      expect(result.status).toBe('invalid-contract');
      expect(f.deps.registryStore.listDocuments().length).toBe(before);
      expect(f.deps.registryStore.listReprintLog(f.docA)).toEqual([]);
    } finally {
      f.close();
    }
  }, 30_000);
});

describe('reprint path 3 — reissue = emit with a NEW event key + audit link', () => {
  it('mints D as a fresh ORIGINAL (replayed:false) and stamps reprint_log { reissue, resultDocId: D } against A', async () => {
    const f = await setup(42, 'PS-REPRINT-0005');
    try {
      const result = await f.output.emit({
        documentType: 'payslip',
        payload: f.data,
        businessEvent: { businessObject: 'PAYROLL', businessObjectId: 'PS-REPRINT-0005', event: 'payslip.reissued', templateVersion: '1.0.0' },
        determination: { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients },
        reissues: { docId: f.docA, actor: CLERK, reason: 'employee lost the original' },
      });
      // `payslip.reissued` is not a rule event — the rules key on
      // `payslip.issued`; a reissue is that SAME business event under a new
      // businessObjectId (a new payroll run / correction), which is what
      // the roadmap's "reissue = new event" means at the key level.
      expect(result.status).toBe('no-rule-match');
      expect(f.deps.registryStore.listReprintLog(f.docA)).toEqual([]);

      const reissued = await f.output.emit({
        documentType: 'payslip',
        payload: f.data,
        businessEvent: { businessObject: 'PAYROLL', businessObjectId: 'PS-REPRINT-0005-R1', event: 'payslip.issued', templateVersion: '1.0.0' },
        determination: { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients },
        reissues: { docId: f.docA, actor: CLERK, reason: 'employee lost the original' },
      });
      expect(reissued.status).toBe('accepted');
      if (reissued.status !== 'accepted') throw new Error('unreachable');
      const primary = reissued.resolutions.find((r) => r.ruleId === 'payslip-default-email')!;
      expect(primary.replayed).toBe(false);
      expect(primary.docId).not.toBe(f.docA);
      const rowD = f.deps.registryStore.getByDocId(primary.docId)!;
      expect(rowD.state).toBe('ORIGINAL');

      const log = f.deps.registryStore.listReprintLog(f.docA);
      expect(log.map((e) => e.action)).toEqual(reissued.resolutions.map(() => 'reissue'));
      expect(log.map((e) => e.resultDocId).sort()).toEqual(reissued.resolutions.map((r) => r.docId).sort());
      expect(log[0]).toMatchObject({ actorRole: 'hr-clerk', actorSubjectId: 'clerk-1', reason: 'employee lost the original' });

      // Row A untouched by a reissue.
      const rowAfter = f.deps.registryStore.getByDocId(f.docA)!;
      expect(rowAfter.state).toBe('ORIGINAL');
      expect(rowAfter.updatedAt).toBe(f.rowA.updatedAt);

      // A replay of the reissue event mints nothing and stamps nothing more.
      const replay = await f.output.emit({
        documentType: 'payslip',
        payload: f.data,
        businessEvent: { businessObject: 'PAYROLL', businessObjectId: 'PS-REPRINT-0005-R1', event: 'payslip.issued', templateVersion: '1.0.0' },
        determination: { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients },
        reissues: { docId: f.docA, actor: CLERK, reason: 'employee lost the original' },
      });
      expect(replay.status).toBe('accepted');
      if (replay.status !== 'accepted') throw new Error('unreachable');
      expect(replay.resolutions.every((r) => r.replayed)).toBe(true);
      expect(f.deps.registryStore.listReprintLog(f.docA)).toHaveLength(log.length);
    } finally {
      f.close();
    }
  }, 60_000);
});

describe('reprint authorization — evaluated against the DOCUMENT, on all three paths', () => {
  it('employee E2 is forbidden on reproduce / regenerate / reissue with NOTHING written and the archive never read', async () => {
    const f = await setup(42, 'PS-REPRINT-0006');
    try {
      const retrieveSpy = vi.spyOn(f.deps.archiveStore, 'retrieve');
      const before = f.deps.registryStore.listDocuments().length;
      const det = { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients };

      expect(await f.output.reproduce({ docId: f.docA, actor: f.e2, reason: 'r' })).toEqual({ status: 'forbidden', docId: f.docA });
      expect(await f.output.regenerate({ docId: f.docA, actor: f.e2, reason: 'r', payload: f.data, determination: det })).toEqual({
        status: 'forbidden',
        docId: f.docA,
      });
      expect(
        await f.output.emit({
          documentType: 'payslip',
          payload: f.data,
          businessEvent: { businessObject: 'PAYROLL', businessObjectId: 'PS-REPRINT-0006-R1', event: 'payslip.issued', templateVersion: '1.0.0' },
          determination: det,
          reissues: { docId: f.docA, actor: f.e2, reason: 'r' },
        }),
      ).toEqual({ status: 'forbidden', docId: f.docA });

      expect(retrieveSpy).not.toHaveBeenCalled();
      expect(f.deps.registryStore.listReprintLog(f.docA)).toEqual([]);
      expect(f.deps.registryStore.listDocuments().length).toBe(before);
      expect(f.deps.registryStore.getByDocId(f.docA)!.updatedAt).toBe(f.rowA.updatedAt);
      retrieveSpy.mockRestore();
    } finally {
      f.close();
    }
  }, 30_000);

  it('owner E1 and hr-clerk are allowed on all three; a purchase-order row default-allows any role', async () => {
    const f = await setup(42, 'PS-REPRINT-0007');
    try {
      const det = { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients };
      for (const [i, actor] of [f.e1, CLERK].entries()) {
        expect((await f.output.reproduce({ docId: f.docA, actor, reason: 'r' })).status).toBe('reproduced');
        expect((await f.output.regenerate({ docId: f.docA, actor, reason: 'r', payload: f.data, determination: det })).status).toBe('regenerated');
        expect(
          (
            await f.output.emit({
              documentType: 'payslip',
              payload: f.data,
              businessEvent: { businessObject: 'PAYROLL', businessObjectId: `PS-REPRINT-0007-R${i}`, event: 'payslip.issued', templateVersion: '1.0.0' },
              determination: det,
              reissues: { docId: f.docA, actor, reason: 'r' },
            })
          ).status,
        ).toBe('accepted');
      }
      expect(f.deps.registryStore.listReprintLog(f.docA).map((e) => e.action)).toEqual(
        expect.arrayContaining(['reproduce', 'regenerate', 'reissue']),
      );

      // Purchase order: no natural-person owner -> coarse default-allow.
      const po = await f.output.emit({
        documentType: 'purchase-order',
        payload: validPurchaseOrder(),
        businessEvent: { businessObject: 'EKKO', businessObjectId: '4500009999', event: 'po.released', templateVersion: '1.0.0' },
      });
      expect(po.status).toBe('accepted');
      if (po.status !== 'accepted') throw new Error('unreachable');
      const poDoc = po.resolutions[0].docId;
      const anyone: Actor = { role: 'warehouse', subjectId: 'w-1' };
      expect((await f.output.reproduce({ docId: poDoc, actor: anyone, reason: 'r' })).status).toBe('reproduced');
      expect((await f.output.reproduce({ docId: poDoc, actor: f.e2, reason: 'r' })).status).toBe('reproduced');
    } finally {
      f.close();
    }
  }, 90_000);

  it('missing subjectId -> actor-required; blank reason -> reason-required; unknown docId -> unknown-document — on all three, nothing written', async () => {
    const f = await setup(42, 'PS-REPRINT-0008');
    try {
      const det = { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients };
      const noSubject: Actor = { role: 'hr-clerk' };
      const emitWith = (audit: { docId: string; actor: Actor; reason: string }) =>
        f.output.emit({
          documentType: 'payslip',
          payload: f.data,
          businessEvent: { businessObject: 'PAYROLL', businessObjectId: 'PS-REPRINT-0008-R1', event: 'payslip.issued', templateVersion: '1.0.0' },
          determination: det,
          reissues: audit,
        });

      expect(await f.output.reproduce({ docId: f.docA, actor: noSubject, reason: 'r' })).toEqual({ status: 'actor-required', docId: f.docA });
      expect(await f.output.regenerate({ docId: f.docA, actor: noSubject, reason: 'r', payload: f.data })).toEqual({ status: 'actor-required', docId: f.docA });
      expect(await emitWith({ docId: f.docA, actor: noSubject, reason: 'r' })).toEqual({ status: 'actor-required', docId: f.docA });

      expect(await f.output.reproduce({ docId: f.docA, actor: CLERK, reason: '   ' })).toEqual({ status: 'reason-required', docId: f.docA });
      expect(await f.output.regenerate({ docId: f.docA, actor: CLERK, reason: '', payload: f.data })).toEqual({ status: 'reason-required', docId: f.docA });
      expect(await emitWith({ docId: f.docA, actor: CLERK, reason: '' })).toEqual({ status: 'reason-required', docId: f.docA });

      expect(await f.output.reproduce({ docId: 'nope', actor: CLERK, reason: 'r' })).toEqual({ status: 'unknown-document', docId: 'nope' });
      expect(await f.output.regenerate({ docId: 'nope', actor: CLERK, reason: 'r', payload: f.data })).toEqual({ status: 'unknown-document', docId: 'nope' });
      expect(await emitWith({ docId: 'nope', actor: CLERK, reason: 'r' })).toEqual({ status: 'unknown-document', docId: 'nope' });

      expect(f.deps.registryStore.listReprintLog(f.docA)).toEqual([]);
      expect(f.deps.registryStore.listByEventKey({ businessObject: 'PAYROLL', businessObjectId: 'PS-REPRINT-0008-R1', event: 'payslip.issued', templateVersion: '1.0.0' })).toEqual([]);
    } finally {
      f.close();
    }
  }, 30_000);
});

describe('reprint log-scrub — paths 1–3 with console intercepted; no PII value in any captured line', () => {
  it('reproduce, regenerate, and reissue never put a payload field, recipient, or rendered message on a log line', async () => {
    const f = await setup(42, 'PS-REPRINT-0009');
    const det = { locale: f.routing.locale, country: f.routing.country, recipients: f.routing.recipients };
    const capture = captureConsole();
    let rendered: string[] = [];
    try {
      const r1 = await f.output.reproduce({ docId: f.docA, actor: CLERK, reason: 'audit request' });
      expect(r1.status).toBe('reproduced');
      const r2 = await f.output.regenerate({ docId: f.docA, actor: CLERK, reason: 'reprint for employee', payload: f.data, determination: det });
      expect(r2.status).toBe('regenerated');
      if (r2.status !== 'regenerated' || r2.composition?.outcome !== 'rendered') throw new Error('unreachable');
      const job = f.deps.deliveryQueue.getJob(r2.composition.deliveryJobId);
      expect(job?.message).toBeDefined();
      rendered = [job!.message!.subject, job!.message!.body];
      const r3 = await f.output.emit({
        documentType: 'payslip',
        payload: f.data,
        businessEvent: { businessObject: 'PAYROLL', businessObjectId: 'PS-REPRINT-0009-R1', event: 'payslip.issued', templateVersion: '1.0.0' },
        determination: det,
        reissues: { docId: f.docA, actor: CLERK, reason: 'employee lost the original' },
      });
      expect(r3.status).toBe('accepted');
    } finally {
      capture.restore();
      f.close();
    }
    const needles = piiNeedles(f.data, f.routing, rendered);
    for (const line of capture.lines) {
      for (const needle of needles) {
        expect(line, `log line unexpectedly contains a PII value ("${needle}"): ${line}`).not.toContain(needle);
      }
    }
  }, 60_000);
});
