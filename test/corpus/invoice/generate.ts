/**
 * Deterministic seeded InvoiceData generator (ROADMAP Stage 4 "Invoice:
 * tax/multi-currency contract + template" corpus). Mirrors
 * test/corpus/purchase-order/generate.ts exactly: structurally valid by
 * construction against packages/schema/contracts/invoice.schema.json, no
 * ajv needed — the shape comes straight from packages/schema's TypeScript
 * types. No Math.random()/Date.now() anywhere — mulberry32 (rng.ts,
 * copied verbatim from the purchase-order corpus) only.
 *
 * MULTI-CURRENCY SCOPE DECISION (ROADMAP Stage 4 task, read before adding
 * a "genuine FX" case): `invoice.schema.json`'s header carries its own
 * `currency`, and `Money` (common.schema.json) ALSO carries a `currency`
 * per instance on every `unitPrice`/`netAmount`/totals field. That means
 * the contract already technically permits a line item priced in a
 * different currency than the header — but nothing enforces consistency
 * or does conversion, and there is no `fxRate` field or documented base/
 * settlement-currency split.
 *
 * Decision: (b) — "multi-currency" for THIS task means "any invoice can be
 * issued in any single ISO 4217 currency", which the contract already
 * supports today. This generator threads ONE currency (picked per seed,
 * same technique as purchase-order/generate.ts's `pick(rand, CURRENCIES)`)
 * through the header AND every line's Money fields AND totals — proving
 * that path end to end across the corpus (each case below independently
 * seeds a different currency). Genuine mixed-currency-per-line invoicing
 * (an `fxRate` field, a documented base-vs-transaction-currency split for
 * `totals`) is a real future extension but is NOT required to prove this
 * task's DoD ("corpus cases green") and is deliberately deferred —
 * building it now would be exactly the gold-plating CLAUDE.md's "never
 * gold-plate" rule warns against: no corpus case or downstream consumer
 * asks for FX conversion yet, and adding `fxRate` to the schema without a
 * driving use case would be schema churn with no test proving it's right.
 * No `invoice.schema.json` / `common.schema.json` changes were made for
 * this task.
 */
import type { Address, InvoiceData, Party } from '@busy-office/output-schema';
import { INVOICE_SCHEMA_VERSION } from '@busy-office/output-schema';
import { intRange, mulberry32, pick } from './rng.js';

const UOM_CODES = ['EA', 'H87', 'KGM', 'GRM', 'LTR', 'MTR', 'MTK', 'MTQ', 'PR', 'SET', 'DZN', 'BX', 'PK', 'C62'] as const;
const CURRENCIES = ['USD', 'EUR', 'SGD'] as const;
const COUNTRIES = ['US', 'DE', 'SG'] as const;
/** A handful of real-world VAT/GST rates, including a zero-rated line — exercises the schema's per-line `taxRate` (0..1). */
const TAX_RATES = [0, 0.07, 0.08, 0.09, 0.19, 0.2, 0.21] as const;

function genAddress(rand: () => number, i: number): Address {
  return {
    line1: `${intRange(rand, 1, 999)} Commerce Ave`,
    line2: i % 3 === 0 ? `Floor ${intRange(rand, 1, 40)}` : undefined,
    city: pick(rand, ['Springfield', 'Rivertown', 'Fairview', 'Millbrook']),
    postalCode: String(intRange(rand, 10000, 99999)),
    country: pick(rand, COUNTRIES),
  };
}

function genParty(rand: () => number, kind: 'seller' | 'buyer'): Party {
  const i = intRange(rand, 1, 9999);
  return {
    name: `${kind === 'seller' ? 'Acme Supplies Inc' : 'Northwind Retail Ltd'} #${i}`,
    address: genAddress(rand, i),
  };
}

export interface GenerateOptions {
  seed: number;
  lineCount: number;
  /** When true, cycle through TAX_RATES deterministically instead of picking randomly (tax-rate-variation case). */
  varyTaxRates?: boolean;
}

export function generateInvoice(opts: GenerateOptions): InvoiceData {
  const rand = mulberry32(opts.seed);
  const currency = pick(rand, CURRENCIES);

  const seller = genParty(rand, 'seller');
  const buyer = genParty(rand, 'buyer');

  const lines = Array.from({ length: opts.lineCount }, (_, idx) => {
    const lineNumber = idx + 1;
    const quantity = intRange(rand, 1, 500);
    const unitPriceAmount = intRange(rand, 100, 250_000); // cents
    const netAmount = quantity * unitPriceAmount;
    const taxRate = opts.varyTaxRates ? TAX_RATES[idx % TAX_RATES.length]! : pick(rand, TAX_RATES);
    return {
      lineNumber,
      description: `Line ${lineNumber} — ${pick(rand, ['consulting hours', 'license seat', 'support plan', 'hardware unit', 'freight', 'installation'])}`,
      quantity,
      unitOfMeasure: pick(rand, UOM_CODES),
      unitPrice: { currency, amount: unitPriceAmount },
      taxRate,
      netAmount: { currency, amount: netAmount },
    };
  });

  const netTotalAmount = lines.reduce((sum, l) => sum + l.netAmount.amount, 0);
  const taxTotalAmount = lines.reduce((sum, l) => sum + Math.round(l.netAmount.amount * l.taxRate), 0);
  const grandTotalAmount = netTotalAmount + taxTotalAmount;

  return {
    schemaVersion: INVOICE_SCHEMA_VERSION,
    documentType: 'invoice',
    header: {
      invoiceNumber: `INV-${String(opts.seed).padStart(6, '0')}`,
      invoiceDate: '2026-08-27',
      dueDate: '2026-09-26',
      currency,
      seller,
      buyer,
      poReference: `PO-${String(intRange(rand, 100000, 999999))}`,
    },
    lines,
    totals: {
      netTotal: { currency, amount: netTotalAmount },
      taxTotal: { currency, amount: taxTotalAmount },
      grandTotal: { currency, amount: grandTotalAmount },
    },
  };
}

/**
 * Named corpus cases (ROADMAP Stage 4). Line counts are tuned empirically
 * against the actual Typst layout (9pt text, A4, 40pt margins, 7-column
 * table — one more column than purchase-order's, so page-break points
 * differ slightly), same technique as
 * test/corpus/purchase-order/generate.ts's CORPUS_CASES.
 */
export const CORPUS_CASES = {
  '001-single-page': { seed: 1, lineCount: 5 }, // -> 1 page, standard single-currency invoice
  '002-multi-page-carry-forward': { seed: 4, lineCount: 120 }, // -> several pages, carry-forward footer exercised on every one
  '003-tax-rate-variation': { seed: 8, lineCount: 14, varyTaxRates: true }, // cycles through TAX_RATES incl. a zero-rated line
  '004-overflow-must-fail': { seed: 6, lineCount: 2100 }, // -> comfortably over DEFAULT_MAX_PAGES (60)
  '005-empty-lines': { seed: 7, lineCount: 0 },
} as const;

export type CorpusCaseName = keyof typeof CORPUS_CASES;
