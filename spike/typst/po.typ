// Spike B — Typst renderer for the reference 120-line purchase order.
// What this must prove (the Stage 0 gate):
//   1. column header repeats on every page          -> table.header(repeat: true)
//   2. carry-forward subtotal at each page break    -> table.footer + state()
//   3. totals block never splits                    -> block(breakable: false)
//   4. data loaded straight from the shared JSON    -> json()
//
//   typst compile po.typ out.pdf

#let data = json("../data/reference-po-120-lines.json")
#let hd = data.header

#set page(paper: "a4", margin: (x: 14mm, top: 18mm, bottom: 20mm),
  header: context [
    #set text(size: 8pt)
    *Purchase Order #hd.poNumber* #h(1fr) Page #counter(page).display()
  ])
#set text(size: 8pt, font: "DejaVu Sans")

// -- money formatting (Typst has no locale formatter; small helper) --------
#let money(n) = {
  let cents = calc.round(n * 100)
  let whole = str(calc.floor(cents / 100))
  let frac = str(calc.rem(cents, 100))
  if frac.len() == 1 { frac = "0" + frac }
  let out = ""
  let i = 0
  for c in whole.rev().clusters() {
    if i != 0 and calc.rem(i, 3) == 0 { out = "," + out }
    out = c + out
    i += 1
  }
  out + "." + frac
}

// -- running total, read by the repeating footer at each page break --------
#let running = state("running", 0)

// document header block (page 1 only, by normal flow)
#grid(columns: (1fr, 1fr), gutter: 4mm,
  [*Vendor* \ #hd.vendor.name (#hd.vendor.vendorNo) \ #hd.vendor.address.join("\n")],
  [*Ship to* \ #hd.shipTo.join("\n") \ \ Date #hd.poDate — #hd.currency — #hd.paymentTerms — #hd.incoterms],
)
#v(3mm)

#let rows = ()
#for line in data.lines {
  rows.push(str(line.pos))
  rows.push(raw(line.sku))
  rows.push(line.description)
  rows.push(align(right, str(line.quantity)))
  rows.push(line.unit)
  rows.push(align(right, money(line.unitPrice)))
  // the cell updates the running state as it is laid out
  rows.push(align(right, [#money(line.lineTotal)#running.update(x => x + line.lineTotal)]))
}

#table(
  columns: (auto, auto, 1fr, auto, auto, auto, auto),
  stroke: 0.4pt + gray,
  inset: 3pt,
  table.header(
    repeat: true,
    [*Pos*], [*SKU*], [*Description*], [*Qty*], [*UoM*], [*Unit price*], [*Line total*],
  ),
  ..rows,
  table.footer(
    repeat: true,
    table.cell(colspan: 6, align: right)[_Carried forward_],
    table.cell(align: right, context [_#money(running.at(here()))_]),
  ),
)

// -- totals: measured as one block, never split ----------------------------
#v(2mm)
#block(breakable: false, width: 100%)[
  #align(right)[
    #table(columns: (auto, auto), stroke: none, inset: 3pt, align: right,
      [Subtotal], [#money(data.totals.subtotal)],
      [GST #calc.round(data.totals.gstRate * 100)%], [#money(data.totals.gst)],
      [*Grand total*], [*#money(data.totals.grandTotal)*],
    )
  ]
]
