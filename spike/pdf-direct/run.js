#!/usr/bin/env node
/**
 * Spike C — direct PDF writer (pdf-lib).
 * Renders the reference 120-line PO with:
 *   - manual pagination
 *   - repeating column header on every page
 *   - carry-forward subtotal at each page break ("Carried forward" / "Brought forward")
 *   - totals block that never splits (measured before placement; pushed whole to next page)
 * This is the volume-renderer candidate (ADR-002). It is deliberately ugly:
 * the point is correctness of the pagination mechanics and the ms/doc number,
 * not typography.
 *
 *   npm install && node run.js          # writes out.pdf, prints page count
 *   node run.js --bench                 # p50/p95 ms per document
 */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { bench } = require('../bench');

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'reference-po-120-lines.json'), 'utf8'),
);

// --- page geometry (A4, points) ------------------------------------------
const PAGE = { w: 595.28, h: 841.89 };
const M = { top: 56, right: 40, bottom: 56, left: 40 };
const CONTENT_W = PAGE.w - M.left - M.right;

// column layout: pos, sku, description (flex), qty, unit, price, total
const COLS = [
  { key: 'pos', w: 30, align: 'r' },
  { key: 'sku', w: 88, align: 'l' },
  { key: 'description', w: CONTENT_W - 30 - 88 - 40 - 30 - 62 - 78, align: 'l' },
  { key: 'quantity', w: 40, align: 'r' },
  { key: 'unit', w: 30, align: 'l' },
  { key: 'unitPrice', w: 62, align: 'r' },
  { key: 'lineTotal', w: 78, align: 'r' },
];
const FS = 8; // body font size
const LH = 10; // line height
const money = (n) =>
  n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function render() {
  const pdf = await PDFDocument.create();
  // Determinism note (HLD §8): zero these or output hashes never match.
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // greedy word wrap using real font metrics — the "measure" half of ADR-001
  const wrap = (text, width, f = font, size = FS) => {
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (f.widthOfTextAtSize(cand, size) <= width) cur = cand;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  let page, y, pageNo = 0;
  const cell = (p, text, x, w, align, f = font, size = FS, yy = y) => {
    const t = String(text);
    const tw = f.widthOfTextAtSize(t, size);
    p.drawText(t, { x: align === 'r' ? x + w - tw : x, y: yy, size, font: f });
  };

  const drawDocHeader = (p) => {
    // compact document header; full header only on page 1
    let hy = PAGE.h - M.top + 14;
    cell(p, `Purchase Order ${data.header.poNumber}`, M.left, 300, 'l', bold, 11, hy);
    cell(p, `Page ${pageNo}`, M.left, CONTENT_W, 'r', font, 8, hy);
    if (pageNo === 1) {
      hy -= 16;
      const h = data.header;
      const block = [
        `Vendor: ${h.vendor.name} (${h.vendor.vendorNo})`,
        ...h.vendor.address.map((a) => `        ${a}`),
        `Ship to: ${h.shipTo.join(', ')}`,
        `Date: ${h.poDate}   Currency: ${h.currency}   Terms: ${h.paymentTerms}   ${h.incoterms}`,
      ];
      for (const line of block) {
        cell(p, line, M.left, CONTENT_W, 'l', font, 8, hy);
        hy -= LH;
      }
      return hy - 6;
    }
    return hy - 10;
  };

  const drawColHeader = (p) => {
    const labels = { pos: 'Pos', sku: 'SKU', description: 'Description', quantity: 'Qty', unit: 'UoM', unitPrice: 'Unit price', lineTotal: 'Line total' };
    let x = M.left;
    for (const c of COLS) { cell(p, labels[c.key], x, c.w - 4, c.align, bold, FS); x += c.w; }
    y -= 4;
    p.drawLine({ start: { x: M.left, y }, end: { x: M.left + CONTENT_W, y }, thickness: 0.6, color: rgb(0, 0, 0) });
    y -= LH;
  };

  let carried = 0; // running total across pages
  const newPage = (broughtForward) => {
    pageNo += 1;
    page = pdf.addPage([PAGE.w, PAGE.h]);
    y = drawDocHeader(page);
    drawColHeader(page);
    if (broughtForward) {
      cell(page, 'Brought forward', M.left + 30 + 4, 88, 'l', bold, FS);
      cell(page, money(carried), M.left + CONTENT_W - 78, 78 - 0, 'r', bold, FS);
      y -= LH + 2;
    }
  };

  const carryForwardH = LH + 2;
  const bottomLimit = M.bottom + carryForwardH; // reserve room for "Carried forward"
  const drawCarriedForward = () => {
    cell(page, 'Carried forward', M.left + 30 + 4, 120, 'l', bold, FS, M.bottom);
    cell(page, money(carried), M.left + CONTENT_W - 78, 78, 'r', bold, FS, M.bottom);
  };

  newPage(false);

  // --- line items ---------------------------------------------------------
  for (const line of data.lines) {
    const descLines = wrap(line.description, COLS[2].w - 6);
    const rowH = descLines.length * LH + 2;
    if (y - rowH < bottomLimit) {           // row does not fit whole → break page
      drawCarriedForward();                 // (rows are kept together: no mid-row splits)
      newPage(true);
    }
    let x = M.left;
    const vals = {
      pos: line.pos, sku: line.sku, description: descLines, quantity: line.quantity,
      unit: line.unit, unitPrice: money(line.unitPrice), lineTotal: money(line.lineTotal),
    };
    for (const c of COLS) {
      const v = vals[c.key];
      if (Array.isArray(v)) v.forEach((t, i) => cell(page, t, x, c.w - 6, c.align, font, FS, y - i * LH));
      else cell(page, v, x, c.w - 6, c.align);
      x += c.w;
    }
    carried = Math.round((carried + line.lineTotal) * 100) / 100;
    y -= rowH;
  }

  // --- totals block: measured first, never split --------------------------
  const t = data.totals;
  const totalRows = [
    ['Subtotal', money(t.subtotal)],
    [`GST ${Math.round(t.gstRate * 100)}%`, money(t.gst)],
    ['Grand total', money(t.grandTotal)],
  ];
  const totalsH = totalRows.length * (LH + 2) + 10;
  if (y - totalsH < M.bottom) {             // does not fit → push the whole block
    drawCarriedForward();
    newPage(true);
  }
  y -= 6;
  page.drawLine({ start: { x: M.left + CONTENT_W - 170, y: y + LH }, end: { x: M.left + CONTENT_W, y: y + LH }, thickness: 0.6, color: rgb(0, 0, 0) });
  for (const [label, val] of totalRows) {
    cell(page, label, M.left + CONTENT_W - 170, 90, 'l', bold, FS);
    cell(page, val, M.left + CONTENT_W - 78, 78, 'r', bold, FS);
    y -= LH + 2;
  }

  return pdf.save();
}

(async () => {
  const bytes = await render();
  fs.writeFileSync(path.join(__dirname, 'out.pdf'), bytes);
  const doc = await PDFDocument.load(bytes);
  console.log(`out.pdf written: ${doc.getPageCount()} pages, ${(bytes.length / 1024).toFixed(0)} KB`);
  if (process.argv.includes('--bench')) await bench('pdf-direct (pdf-lib)', render);
})();
