# Stage 0 results — THE record that outlives this directory

> Container pre-run 2026-08-26 (indicative): pdf-direct p50=37.8ms p95=74.6ms (3 pages, 25KB);
> typst cold-process p50=459ms (3 pages); carbone not run (no LibreOffice in container).
> All numbers below must be re-measured on the target hardware.

## Hardware / environment
- Machine:
- Node / Typst / LibreOffice versions:

## Gate matrix (pass / fail / notes)

| Gate | carbone | typst | pdf-direct |
|---|---|---|---|
| 1 header repeats | | PASS (container) | PASS (container) |
| 2 carry-forward subtotal | | PASS (container) | PASS (container) |
| 3 totals never split | | PASS (container) | PASS (container) |
| 4 wrap, no silent clip | | PASS (container) | PASS (container) |
| 5 ms/doc (p50 warm) | | | |

## Bursting math
target window: ______ min for 8,000 docs → required ≤ ______ ms/doc
achieved: carbone ______ / typst ______ / pdf-direct ______

## Authoring experience notes (feeds ADR-000)
- Carbone (.odt in LibreOffice):
- Typst (markup):
- Who will actually author templates at the target org?

## Licence check
- Carbone CCL read in full? Compatible with intended distribution? Y/N + notes:

## RTL / CJK smoke test (do NOT defer to Stage 6)
- th-TH rendered correctly in winner? ja-JP? ar-SA?

## Decision
- ADR-000 (authoring model): Path ___ because
- ADR-001 (pagination location): decided / N-A because
- ADR-002 (volume renderer): decided / deferred because
