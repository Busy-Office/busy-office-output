/**
 * Deterministic seeded PurchaseOrderData generator (ROADMAP Stage 2 corpus
 * scaffold). Structurally valid by construction against
 * packages/schema/contracts/purchase-order.schema.json — no ajv needed,
 * the shape is produced directly from packages/schema's TypeScript types.
 * No Math.random()/Date.now() anywhere — mulberry32 (rng.ts) only, so the
 * same seed always produces byte-identical data.
 */
import type { Address, Party, PurchaseOrderData } from '@busy-office/output-schema';
import { PURCHASE_ORDER_SCHEMA_VERSION } from '@busy-office/output-schema';
import { intRange, mulberry32, pick } from './rng.js';

const UOM_CODES = ['EA', 'H87', 'KGM', 'GRM', 'LTR', 'MTR', 'MTK', 'MTQ', 'PR', 'SET', 'DZN', 'BX', 'PK', 'C62'] as const;
const CURRENCIES = ['USD', 'EUR', 'SGD'] as const;
const COUNTRIES = ['US', 'DE', 'SG'] as const;

function genAddress(rand: () => number, i: number): Address {
  return {
    line1: `${intRange(rand, 1, 999)} Industrial Way`,
    line2: i % 3 === 0 ? `Suite ${intRange(rand, 100, 999)}` : undefined,
    city: pick(rand, ['Springfield', 'Rivertown', 'Fairview', 'Millbrook']),
    postalCode: String(intRange(rand, 10000, 99999)),
    country: pick(rand, COUNTRIES),
  };
}

function genParty(rand: () => number, kind: 'buyer' | 'vendor'): Party {
  const i = intRange(rand, 1, 9999);
  return {
    name: `${kind === 'buyer' ? 'Acme Buyer Corp' : 'Northwind Vendor Ltd'} #${i}`,
    address: genAddress(rand, i),
  };
}

export interface GenerateOptions {
  seed: number;
  lineCount: number;
}

export function generatePurchaseOrder(opts: GenerateOptions): PurchaseOrderData {
  const rand = mulberry32(opts.seed);
  const currency = pick(rand, CURRENCIES);

  const buyer = genParty(rand, 'buyer');
  const vendor = genParty(rand, 'vendor');

  const lines = Array.from({ length: opts.lineCount }, (_, idx) => {
    const lineNumber = idx + 1;
    const quantity = intRange(rand, 1, 500);
    const unitPriceAmount = intRange(rand, 100, 250_000); // cents
    const netAmount = quantity * unitPriceAmount;
    return {
      lineNumber,
      materialId: `MAT-${String(intRange(rand, 10000, 99999))}`,
      description: `Component ${lineNumber} — ${pick(rand, ['bracket', 'gasket', 'housing', 'fastener kit', 'sensor module', 'wiring harness'])}`,
      quantity,
      unitOfMeasure: pick(rand, UOM_CODES),
      unitPrice: { currency, amount: unitPriceAmount },
      netAmount: { currency, amount: netAmount },
    };
  });

  const netTotalAmount = lines.reduce((sum, l) => sum + l.netAmount.amount, 0);
  const taxRateBp = 800; // 8.00%, basis points, kept as a local constant — not part of the frozen contract
  const taxTotalAmount = Math.round((netTotalAmount * taxRateBp) / 10000);
  const grandTotalAmount = netTotalAmount + taxTotalAmount;

  return {
    schemaVersion: PURCHASE_ORDER_SCHEMA_VERSION,
    documentType: 'purchase-order',
    header: {
      poNumber: `PO-${String(opts.seed).padStart(6, '0')}`,
      poDate: '2026-08-27',
      currency,
      buyer,
      vendor,
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
 * The 7 named corpus cases (ROADMAP Stage 2). Line counts are tuned
 * empirically against the actual Typst layout (9pt text, A4, 40pt margins,
 * 7-column table) — see test/corpus/purchase-order/*.test.ts for how each
 * is exercised.
 */
export const CORPUS_CASES = {
  '001-single-page': { seed: 1, lineCount: 5 }, // -> 1 page
  '002-two-page': { seed: 2, lineCount: 45 }, // -> 2 pages
  '003-ten-page': { seed: 3, lineCount: 280 }, // -> 10 pages (empirically tuned, see session report)
  '004-120-line-carry-forward': { seed: 4, lineCount: 120 }, // -> 5 pages, carry-forward exercised across all of them
  // Empirically the tightest boundary for this template (A4/40pt margins/9pt text/seed 5):
  // n=26 -> totals still fits page 1 (1 page total); n=27 -> totals is pushed to page 2 (2 pages
  // total) without splitting or clipping. See session report's sweep for the n=24..38 scan.
  '005-totals-at-boundary': { seed: 5, lineCount: 27 },
  '006-overflow-must-fail': { seed: 6, lineCount: 2100 }, // -> 68 pages, comfortably over DEFAULT_MAX_PAGES (60)
  '007-empty-lines': { seed: 7, lineCount: 0 },
} as const;

export type CorpusCaseName = keyof typeof CORPUS_CASES;
