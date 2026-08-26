// RTL/CJK smoke test for the typst candidate — ROADMAP Stage 0 task
// "RTL + CJK smoke test (th-TH, ja-JP, ar-SA)". Uses whatever fonts typst
// resolves from the system font book (no bundled fonts, no install step).
// Run from the repo root:
//   typst compile --root . spike/typst/rtl-cjk-smoke.typ spike/typst/out-rtl-cjk-smoke.pdf

#set page(width: 400pt, height: 200pt, margin: 20pt)
#set text(size: 14pt)

#stack(spacing: 20pt,
  [ใบสั่งซื้อ สินค้า จำนวน ราคา บริษัท กรุงเทพฯ],
  [発注書 商品名 数量 価格 東京都],
  text(font: "SF Arabic")[أمر شراء اسم المنتج الكمية السعر الرياض],
)
