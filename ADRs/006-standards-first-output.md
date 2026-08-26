# ADR-006 — Standards-first output

**Status:** Accepted — maintainer directive, 2026-08-26.
**Policy detail:** `docs/STANDARDS.md`.

## Decision

Busy Office Output complies with open standards as much as possible, adopted
by tier: Tier 1 identity/data codes into the Stage 1 contracts (retrofitting
codes is a breaking contract change); Tier 2 artifact and API standards as
product value (PDF/A-2b archive profile validated by veraPDF, CloudEvents
envelope, RFC 9457 errors); Tier 3 market-entry standards (EN 16931/Peppol
PINT-SG, Factur-X, PAdES, PDF/UA-1) on the deferred-table triggers, with
their contract fields reserved in Tier 1.

Two safeguards keep this from becoming checklist scope creep:
1. **No claim without a validator** — compliance is asserted by CI (veraPDF,
   Schematron, schema validation), never by intention.
2. **Tier 3 stays trigger-gated** — the standards are named and the fields
   reserved, but implementation waits for the deferred-table trigger.

## Consequences

- Stage 1 gains the code-adoption task (incl. fixing our own reference data's
  non-Rec-20 UoM values).
- Stage 2's archive gate becomes "PDF/A-2b, veraPDF-clean" — which exposes a
  real gap in pdf-direct (non-embedded standard fonts) and strengthens Typst
  (full PDF/A + UA-1 since 0.14) and Carbone/LibreOffice in ADR-000/002.
- "Archive is the reproduction" upgrades from a policy to a standard: the
  thing archived is an ISO-specified long-term format.
- The SG e-invoicing wave (GST InvoiceNow to all GST-registered businesses,
  2028–2031) is recorded as dated market context for the Tier 3 trigger — it
  does not by itself start the work.
