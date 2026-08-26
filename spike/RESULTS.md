# Stage 0 results — THE record that outlives this directory

> Container pre-run 2026-08-26 (indicative): pdf-direct p50=37.8ms p95=74.6ms (3 pages, 25KB);
> typst cold-process p50=459ms (3 pages); carbone not run (no LibreOffice in container).
> All numbers below must be re-measured on the target hardware.

## Hardware / environment
- Machine: MacBook Air, Apple M4, 24 GB RAM, macOS 26.5.2 (25F84)
- Node / Typst / LibreOffice versions: Node v26.3.0; typst not installed (GATE-TYPST-INSTALL); LibreOffice not installed (GATE-CARBONE)

## Gate matrix (pass / fail / notes)

| Gate | carbone | typst | pdf-direct |
|---|---|---|---|
| 1 header repeats | | PASS (container) | PASS (container) |
| 2 carry-forward subtotal | | PASS (container) | PASS (container) |
| 3 totals never split | | PASS (container) | PASS (container) |
| 4 wrap, no silent clip | | PASS (container) | PASS (container) |
| 5 ms/doc (p50 warm) | | | PASS — p50=12.1ms p95=14.5ms mean=12.3ms (n=30, 3 pages, 25KB) |

## Bursting math
target window: ______ min for 8,000 docs (GATE-BURST-WINDOW, open) → required ≤ ______ ms/doc
achieved: carbone ______ / typst ______ / pdf-direct 12.1ms p50 → 8,000 docs ≈ 97s single-threaded on
this machine (Apple M4), before parallelism

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
