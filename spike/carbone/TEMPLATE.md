# Authoring `po-template.odt`

Build in LibreOffice Writer (or Word, saved as .odt). ~30 minutes. This IS the
Path B experience — note how it feels; that observation goes in RESULTS.md.

## Header block (page 1)
Plain paragraphs with markers:

    Purchase Order {d.header.poNumber}        Date {d.header.poDate}
    Vendor: {d.header.vendor.name} ({d.header.vendor.vendorNo})
    Terms: {d.header.paymentTerms} — {d.header.incoterms} — {d.header.currency}

## Line-item table
One table, two body rows carrying the repeat markers (Carbone's `[i]`/`[i+1]` loop):

| Pos | SKU | Description | Qty | UoM | Unit price | Line total |
|---|---|---|---|---|---|---|
| {d.lines[i].pos} | {d.lines[i].sku} | {d.lines[i].description} | {d.lines[i].quantity} | {d.lines[i].unit} | {d.lines[i].unitPrice:formatN(2)} | {d.lines[i].lineTotal:formatN(2)} |
| {d.lines[i+1].pos} | | | | | | |

Then, the two settings this spike exists to test:
1. Select the header row → Table ▸ **Repeat Heading Rows** (Word: Table Properties ▸ Row ▸ "Repeat as header row").
2. Totals rows (below the table or as final rows): Subtotal `{d.totals.subtotal:formatN(2)}`,
   GST `{d.totals.gst:formatN(2)}`, Grand total `{d.totals.grandTotal:formatN(2)}` —
   set paragraphs to **Keep with next** so the block cannot split.

## What Path B does NOT give you
Note in RESULTS.md whether you could find any way to do a per-page
**carried-forward subtotal**. The office formats have no native running-total-
at-page-break; both code paths (pdf-direct, Typst) do it. If your invoices
require it, that single requirement may decide ADR-000.
