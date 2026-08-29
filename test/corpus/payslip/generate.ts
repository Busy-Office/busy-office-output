/**
 * Deterministic seeded PayslipData generator (ROADMAP Stage 4 "Payslip:
 * compact template + PII posture" corpus). Mirrors
 * test/corpus/invoice/generate.ts and test/corpus/purchase-order/generate.ts
 * exactly: structurally valid by construction against
 * packages/schema/contracts/payslip.schema.json, no ajv needed — the shape
 * comes straight from packages/schema's TypeScript types. No
 * Math.random()/Date.now() anywhere — mulberry32 (rng.ts, copied verbatim
 * from the invoice/purchase-order corpora) only.
 *
 * FAKE DATA ONLY (docs/POLICY.md "Payslip / PII handling", CLAUDE.md
 * PII discipline): names, employee IDs, and pay component codes below are
 * obviously-synthetic test fixtures — never real PII — but are generated
 * with the same code-level discipline (never logged, never hand-copied
 * into assertions in a way that would make a leak-check meaningless) as
 * if they were real, because this corpus exists specifically to prove that
 * discipline holds end to end.
 */
import type { Address, Party, PayslipData } from '@busy-office/output-schema';
import { PAYSLIP_SCHEMA_VERSION } from '@busy-office/output-schema';
import { intRange, mulberry32, pick } from './rng.js';

const CURRENCIES = ['USD', 'EUR', 'SGD'] as const;
const COUNTRIES = ['US', 'DE', 'SG'] as const;
const FIRST_NAMES = ['Jordan', 'Alexis', 'Priya', 'Wei', 'Sam', 'Devon', 'Casey', 'Robin'] as const;
const LAST_NAMES = ['Rivera', 'Tan', 'Schmidt', 'Okafor', 'Nguyen', 'Kowalski', 'Alvarez', 'Bergstrom'] as const;

/** Pay component codes, split by line type — mirrors real payroll codes
 * closely enough to exercise the earnings/deductions distinction without
 * being any real employer's actual code list. */
const EARNING_COMPONENTS = [
  { code: 'BASIC', description: 'Base salary' },
  { code: 'OT', description: 'Overtime' },
  { code: 'BONUS', description: 'Performance bonus' },
  { code: 'ALLOW', description: 'Housing allowance' },
] as const;
const DEDUCTION_COMPONENTS = [
  { code: 'TAX', description: 'Income tax' },
  { code: 'SSEC', description: 'Social security' },
  { code: 'HLTH', description: 'Health insurance' },
  { code: 'RET', description: 'Retirement contribution' },
] as const;

function genAddress(rand: () => number): Address {
  return {
    line1: `${intRange(rand, 1, 999)} Payroll Plaza`,
    city: pick(rand, ['Springfield', 'Rivertown', 'Fairview', 'Millbrook']),
    postalCode: String(intRange(rand, 10000, 99999)),
    country: pick(rand, COUNTRIES),
  };
}

function genEmployer(rand: () => number): Party {
  const i = intRange(rand, 1, 9999);
  return { name: `Acme Employer Holdings #${i}`, address: genAddress(rand) };
}

export interface GenerateOptions {
  seed: number;
  /** Number of earning lines and number of deduction lines, generated
   * separately so a case can force a specific earnings/deductions mix
   * (e.g. more deduction types than earning types) rather than one
   * homogeneous line count. */
  earningCount: number;
  deductionCount: number;
}

export function generatePayslip(opts: GenerateOptions): PayslipData {
  const rand = mulberry32(opts.seed);
  const currency = pick(rand, CURRENCIES);
  const employer = genEmployer(rand);
  const employeeIdNum = intRange(rand, 10000, 99999);
  const employeeName = `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;

  let lineNumber = 0;
  const earningLines = Array.from({ length: opts.earningCount }, (_, idx) => {
    lineNumber += 1;
    const component = EARNING_COMPONENTS[idx % EARNING_COMPONENTS.length]!;
    const amount = intRange(rand, 50_000, 800_000); // cents
    return {
      lineNumber,
      code: component.code,
      description: component.description,
      type: 'earning' as const,
      amount: { currency, amount },
    };
  });
  const deductionLines = Array.from({ length: opts.deductionCount }, (_, idx) => {
    lineNumber += 1;
    const component = DEDUCTION_COMPONENTS[idx % DEDUCTION_COMPONENTS.length]!;
    const amount = intRange(rand, 5_000, 150_000); // cents
    return {
      lineNumber,
      code: component.code,
      description: component.description,
      type: 'deduction' as const,
      amount: { currency, amount },
    };
  });
  const lines = [...earningLines, ...deductionLines];

  const grossPayAmount = earningLines.reduce((sum, l) => sum + l.amount.amount, 0);
  const totalDeductionsAmount = deductionLines.reduce((sum, l) => sum + l.amount.amount, 0);
  const netPayAmount = grossPayAmount - totalDeductionsAmount;

  return {
    schemaVersion: PAYSLIP_SCHEMA_VERSION,
    documentType: 'payslip',
    header: {
      payslipNumber: `PS-${String(opts.seed).padStart(6, '0')}`,
      payPeriodStart: '2026-08-01',
      payPeriodEnd: '2026-08-31',
      payDate: '2026-09-01',
      currency,
      employer,
      employeeId: `EMP-${String(employeeIdNum).padStart(5, '0')}`,
      employeeName,
    },
    lines,
    totals: {
      grossPay: { currency, amount: grossPayAmount },
      totalDeductions: { currency, amount: totalDeductionsAmount },
      netPay: { currency, amount: netPayAmount },
    },
  };
}

/** Locales the routing generator alternates across (>= 2, per the Stage 4
 * exit gate clause 2). Only ROUTING evidence — no template body differs
 * per locale (locale-aware formatting is Stage 6). */
export const ROUTING_LOCALES = ['en-US', 'de-DE'] as const;

/** Per-employee routing context for one payslip event (Stage 4 exit gate
 * clause 2: "per-recipient locale and channel"). This is the caller-side
 * MASTER DATA an ERP would hand the runtime alongside the event — it is
 * deliberately NOT on `PayslipData` (HLD §1: holding master data is
 * outside the boundary; the contract is `additionalProperties: false`). */
export interface PayslipRouting {
  locale: (typeof ROUTING_LOCALES)[number];
  country: (typeof COUNTRIES)[number];
  /** Exactly one synthetic mailbox — `emp-<id>@example.com`, RFC 2606
   * reserved domain, never a real address. The needle
   * payslip-log-scrub.test.ts greps captured console output for. */
  recipients: [string];
}

/**
 * Deterministic per-employee routing for `seed` (mulberry32-free on
 * purpose: plain modular arithmetic over the seed so consecutive seeds —
 * what the bench and the gate test issue — provably alternate across
 * every locale and every country, rather than merely probably).
 *
 * The mailbox id is the SEED (zero-padded like the bench's
 * `businessObjectId`), not `header.employeeId`: employeeId is drawn from a
 * 5-digit space and collides across an 8,000-seed run, and the gate
 * asserts recipients are distinct per document.
 */
export function generatePayslipRouting(seed: number): PayslipRouting {
  const n = Math.abs(seed);
  return {
    locale: ROUTING_LOCALES[n % ROUTING_LOCALES.length]!,
    country: COUNTRIES[n % COUNTRIES.length]!,
    recipients: [`emp-${String(n).padStart(7, '0')}@example.com`],
  };
}

/**
 * Named corpus cases (ROADMAP Stage 4). Line counts tuned empirically
 * against the actual Typst layout (9pt text, A4, 40pt margins, 5-column
 * table), same technique as the invoice/purchase-order corpora.
 *
 * No genuine multi-page case: a payslip's line table is bounded by an
 * employer's pay-component list, not by unbounded per-transaction
 * quantity the way PO/invoice lines are — real-world payslips are
 * overwhelmingly single-page ("compact" is the template's whole point,
 * per this task's name). 003-many-components exercises the largest
 * plausible earnings/deductions mix while staying one page; 004 proves
 * the overflow guard still fires if a payslip somehow WERE handed an
 * unreasonable number of components, so the safety net is not silently
 * untested just because the common case never reaches it.
 */
export const CORPUS_CASES = {
  '001-single-page': { seed: 1, earningCount: 1, deductionCount: 1 }, // -> 1 page, one earning + one tax deduction
  '002-earnings-deductions-mix': { seed: 4, earningCount: 4, deductionCount: 4 }, // -> 1 page, every component type exercised
  '003-empty-lines': { seed: 7, earningCount: 0, deductionCount: 0 },
  '004-overflow-must-fail': { seed: 6, earningCount: 3000, deductionCount: 3000 }, // -> comfortably over DEFAULT_MAX_PAGES (60)
} as const;

export type CorpusCaseName = keyof typeof CORPUS_CASES;
