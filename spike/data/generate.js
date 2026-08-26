#!/usr/bin/env node
/**
 * Generates the reference purchase order used by every spike.
 * Deterministic (seeded PRNG) so all three renderers consume identical data.
 * 120 line items, mixed description lengths, SGD, computed totals.
 */
const fs = require('node:fs');
const path = require('node:path');

// Mulberry32 — tiny seeded PRNG, deterministic across runs
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260826);

const MATERIALS = [
  ['SUB', 'ABF substrate panel', 'pcs'],
  ['CU', 'Copper clad laminate sheet 0.2mm', 'sht'],
  ['SOL', 'SAC305 solder paste, T4, 500g jar', 'jar'],
  ['UF', 'Capillary underfill, 30cc syringe', 'ea'],
  ['DAF', 'Die attach film roll 200mm', 'roll'],
  ['EMC', 'Epoxy molding compound, granular, 25kg', 'bag'],
  ['FLX', 'No-clean flux, 1L bottle', 'btl'],
  ['WIR', 'Au bonding wire 20um, 500m spool', 'spl'],
  ['MSK', 'Solder mask ink, green, 5kg pail', 'pail'],
  ['STN', 'Laser-cut stencil, framed, 736x736', 'ea'],
  ['CHM', 'Micro-etch chemistry concentrate, 20L', 'drm'],
  ['TRY', 'JEDEC matrix tray, bakeable', 'ea'],
];
const LONG_TAIL = [
  'for line 3 qualification build, MSDS required with delivery, store below 25C',
  '(replacement for obsoleted P/N, see ECN-2026-0142; incoming inspection per SIP-QA-011)',
  'vendor-managed inventory replenishment, deliver to Kallang warehouse dock 2 only',
  'lot traceability certificate and CoA required per shipment',
];

const lines = [];
for (let i = 1; i <= 120; i++) {
  const m = MATERIALS[Math.floor(rand() * MATERIALS.length)];
  const longTail = rand() < 0.15 ? ' ' + LONG_TAIL[Math.floor(rand() * LONG_TAIL.length)] : '';
  const qty = Math.ceil(rand() * 500);
  const unitPrice = Math.round(rand() * 48000 + 120) / 100; // 1.20 .. ~481.20
  lines.push({
    pos: i * 10,
    sku: `SBX-${m[0]}-${String(1000 + Math.floor(rand() * 9000))}`,
    description: `${m[1]}${longTail}`,
    quantity: qty,
    unit: m[2],
    unitPrice,
    lineTotal: Math.round(qty * unitPrice * 100) / 100,
    deliveryDate: `2026-${String(9 + Math.floor(rand() * 3)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`,
  });
}
const subtotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
const gst = Math.round(subtotal * 9) / 100; // SG GST 9%
const doc = {
  schemaVersion: '0.1.0',
  documentType: 'purchase-order',
  header: {
    poNumber: 'PO-2026-004217',
    poDate: '2026-08-26',
    currency: 'SGD',
    buyer: {
      name: 'Silicon Box Pte Ltd',
      address: ['2 Changi Business Park Ave 1', 'Singapore 486015'],
      contact: 'purchasing@example.com',
    },
    vendor: {
      name: 'Advanced Materials Supply Pte Ltd',
      address: ['71 Tuas South Ave 3', 'Singapore 637441'],
      vendorNo: 'V-100482',
    },
    shipTo: ['Silicon Box Pte Ltd', 'Receiving Dock 2, Kallang Warehouse', 'Singapore 339156'],
    paymentTerms: 'Net 45',
    incoterms: 'DDP Singapore',
  },
  lines,
  totals: { subtotal, gstRate: 0.09, gst, grandTotal: Math.round((subtotal + gst) * 100) / 100 },
};
const out = path.join(__dirname, 'reference-po-120-lines.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${out}`);
console.log(`lines: ${doc.lines.length}, subtotal: ${subtotal}, grand: ${doc.totals.grandTotal}`);
