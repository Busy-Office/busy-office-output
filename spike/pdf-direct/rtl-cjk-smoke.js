#!/usr/bin/env node
/**
 * RTL/CJK smoke test for the pdf-direct (pdf-lib) candidate — ROADMAP Stage 0
 * task "RTL + CJK smoke test (th-TH, ja-JP, ar-SA)". Uses macOS system fonts
 * (smoke-test only — not for distribution; production needs licensed/bundled
 * fonts). Two of the three system fonts are TrueType Collections (.ttc);
 * pdf-lib/fontkit cannot embed a .ttc directly, so ttc-split.js extracts one
 * face as a standalone sfnt first.
 *
 *   node spike/pdf-direct/rtl-cjk-smoke.js   # writes out-rtl-cjk-smoke.pdf
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { extractFace } = require('./ttc-split');

const FONTS_DIR = '/System/Library/Fonts';
const SAMPLES = [
  { lang: 'th-TH', text: 'ใบสั่งซื้อ สินค้า จำนวน ราคา บริษัท กรุงเทพฯ', font: { ttc: 'ThonburiUI.ttc', face: 0 }, subset: true },
  { lang: 'ja-JP', text: '発注書 商品名 数量 価格 東京都', font: { ttc: 'ヒラギノ角ゴシック W3.ttc'.normalize(), face: 0 }, subset: false },
  { lang: 'ar-SA', text: 'أمر شراء اسم المنتج الكمية السعر الرياض', font: { ttf: 'SFArabic.ttf' }, subset: true },
];

async function main() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([400, 200]);
  let y = 150;

  for (const s of SAMPLES) {
    const bytes = s.font.ttf
      ? fs.readFileSync(path.join(FONTS_DIR, s.font.ttf))
      : extractFace(path.join(FONTS_DIR, s.font.ttc), s.font.face);
    const font = await doc.embedFont(bytes, { subset: s.subset });
    page.drawText(s.text, { x: 20, y, size: 14, font, color: rgb(0, 0, 0) });
    y -= 50;
  }

  const out = path.join(__dirname, 'out-rtl-cjk-smoke.pdf');
  fs.writeFileSync(out, await doc.save());
  console.log('wrote', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
