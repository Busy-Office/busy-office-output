# Standards compliance map

**Policy (ADR-006, accepted):** comply with standards as much as possible —
adopted by tier, not by checklist. Two rules govern everything below:

1. **A compliance claim requires a validator.** "PDF/A-2b" means veraPDF
   passes in CI, not that we intended it. No validator, no claim.
2. **Tier order is cost order.** Tier 1 is nearly free now and a breaking
   change later. Tier 2 is compliance that *is* product value. Tier 3 is
   market entry, adopted on the deferred-table triggers.

---

## Tier 1 — identity and data codes (adopt in Stage 1 contracts; retrofits break the contract)

| Standard | Where it lands | Verification |
|---|---|---|
| ISO 4217 currency codes | money fields carry the code; amounts are numbers, formatting is the renderer's job | contract schema enum/pattern |
| ISO 3166-1 country codes | `VariantKey.country`, addresses | schema pattern |
| BCP 47 locale tags | `VariantKey.locale` — already in the schema | schema pattern |
| ISO 8601 / RFC 3339 | every date and timestamp in contracts, registry, audit | schema `format: date` / `date-time` |
| UNECE Recommendation 20 | unit-of-measure codes (`H87`, `EA`, `KGM`…) with display names alongside — **our own reference generator currently uses `pcs`/`jar`/`sht`; fix in the Stage 1 task** | schema enum against the Rec 20 list |
| ISO 6523 / Peppol EAS | party-identification scheme + id fields *reserved* on buyer/vendor now (GLN, UEN…) so Tier 3 doesn't reshape the contract | schema, optional fields |
| CLDR (via `Intl` / ICU) | all locale formatting — never hand-rolled. The pdf-direct spike already uses `Intl`; the Typst spike's hand-rolled `money()` gets replaced by locale packs in Stage 2/6 | corpus locale cases |

## Tier 2 — artifact and API standards (compliance is product value)

| Standard | Decision | Verification |
|---|---|---|
| **PDF/A-2b** (ISO 19005-2) | the archive profile for every archived artifact — this is what makes "the archive is the reproduction" a durable promise. **PDF/A-3b** when embedding attachments (Stage 4 concatenation, Tier 3 Factur-X) | **veraPDF in the corpus gates** |
| Tagged PDF | baseline wherever the renderer supports it (Typst does by default since 0.14) | veraPDF / renderer flags |
| No artifact-level encryption | PDF/A forbids it; confidentiality is storage-level (encryption at rest + signed URLs), which the HLD already specifies | design rule |
| CloudEvents 1.0 | optional envelope for `POST /event` — ERP emitters get a standard shape for free | contract tests |
| RFC 9457 problem+json | every API error, including the rule-evaluation TRACE on non-match | contract tests |
| JSON Schema 2020-12 / OpenAPI 3.1 | data contracts and the API surface | CI validation |

## Tier 3 — market-entry standards (deferred-table triggers; fields reserved in Tier 1)

| Standard | Trigger and note |
|---|---|
| EN 16931 + Peppol BIS Billing 3.0 / **PINT-SG** | e-invoicing trigger. **Singapore has dated the wave:** GST InvoiceNow phases 2025-11 and 2026-04 (new voluntary registrants), then 2028 → 2029 → 2030 → **2031: all GST-registered businesses**. Generating compliant UBL is in scope on trigger; being a Peppol access point never is. Validation: Peppol Schematron artefacts |
| Factur-X / ZUGFeRD | the elegant bridge: **PDF/A-3 with embedded CII XML** — one artifact, human- and machine-readable. Archive-is-the-reproduction and e-invoicing become the same file |
| Thailand ETDA e-tax invoice/receipt | trigger: a TH-mandated user |
| PAdES B-LT (ETSI EN 319 142) | signatures trigger; pulled forward with e-documents |
| PDF/UA-1 (ISO 14289-1) | accessibility trigger (EAA in force since 2025-06; procurement asks). Typst exports it; out of scope for the volume renderer — route /UA documents to a capable renderer per-template |
| GS1 / ISO-IEC 15417/16022/18004 | barcode symbologies, with the labels item |
| EMVCo QR / SGQR-PayNow, EPC QR, Swiss QR-bill | payment QR on invoices; small, high-value, country-pack material for Stage 6 |

---

## Renderer PDF/A reality (feeds ADR-002)

| Renderer | Status |
|---|---|
| **Typst ≥0.14** (spike ran 0.15.1) | all PDF/A parts and levels (`a-1b`…`a-4e`) plus `ua-1` via `--pdf-standard`; tagged PDF by default; validates on export |
| **LibreOffice / Carbone** | PDF/A-1b/2b/3b export options; /UA partial |
| **pdf-lib (pdf-direct)** | no built-in conformance. Known gaps in our own spike: `StandardFonts.Helvetica` is **not embedded** (a PDF/A violation as-is); no XMP metadata; no OutputIntent ICC. Reaching A-2b = embed a real TTF via fontkit + XMP + OutputIntent (feasible); tagged//UA is out of its scope by design |

Consequence: the standards directive strengthens Typst and Carbone in
ADR-000/002 and adds a Stage 2 workstream to pdf-direct if it stays the volume
renderer. Per-template renderer selection already accommodates routing /UA or
/A-3 documents to a capable renderer.
