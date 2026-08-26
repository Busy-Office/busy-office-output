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
target window is still undecided (GATE-BURST-WINDOW, open). Parametrized
against 8,000 docs so the decision doesn't block the math:

| Window | Required ms/doc (single-threaded budget) | pdf-direct p50=12.1ms — margin |
|---|---|---|
| 5 min (300s) | 37.5 ms/doc | 3.1x under budget |
| 15 min (900s) | 112.5 ms/doc | 9.3x under budget |
| 30 min (1800s) | 225 ms/doc | 18.6x under budget |
| 60 min (3600s) | 450 ms/doc | 37.2x under budget |

pdf-direct alone, single-threaded, renders 8,000 docs in ≈97s (8,000 ×
12.1ms) — that already clears every window above from a *single Node
process*, no fan-out required. This machine has 10 cores (4P + 6E,
`sysctl hw.perflevel0/1.physicalcpu`); worker-pool fan-out across even 4
processes would put 8,000 docs at ≈24s. **pdf-direct's raw throughput is
not the bottleneck at any plausible window** — carbone/typst numbers still
needed (GATE-CARBONE, GATE-TYPST-INSTALL) before this table is complete,
but pdf-direct already clears the Stage-0 exit-gate-3 bursting condition on
its own. The open question that remains is GATE-RTL-SHAPING, not throughput.
achieved: carbone ______ / typst ______ / pdf-direct 12.1ms p50 (see table above)

## Authoring experience notes (feeds ADR-000)
- Carbone (.odt in LibreOffice):
- Typst (markup):
- Who will actually author templates at the target org?

## Licence check
- Carbone CCL read in full? Compatible with intended distribution? Y/N + notes:

## RTL / CJK smoke test (do NOT defer to Stage 6)
Candidate: pdf-direct (pdf-lib), measured on this Mac (Apple M4). Fonts:
macOS system fonts, smoke-test only — not licensed for redistribution;
production needs bundled/licensed fonts regardless of outcome here. Two of
the three (Thai, Japanese) ship as `.ttc` collections; pdf-lib/fontkit
cannot embed a `.ttc` directly, so `spike/pdf-direct/ttc-split.js` extracts
one face as a standalone sfnt first (binary table-directory copy, no
resampling). Reproduce: `node spike/pdf-direct/rtl-cjk-smoke.js`, then
rasterize `spike/pdf-direct/out-rtl-cjk-smoke.pdf`.

| Script | Font (face) | subset | Result |
|---|---|---|---|
| th-TH | ThonburiUI.ttc (`.ThonburiUI-Regular`) | true | **PASS** — renders correctly, combining tone/vowel marks stack right. Thai doesn't need contextual shaping (marks are self-contained in the font's per-glyph metrics), so pdf-lib's plain codepoint→glyph draw is sufficient. |
| ja-JP | ヒラギノ角ゴシック W3.ttc (`HiraginoSans-W3`) | true | **FAIL** — tofu boxes; poppler reports "Embedded font file may be invalid". pdf-lib's TrueType subsetter breaks on this font (20,339 glyphs, many composite/component glyphs) — a subsetting bug, not a shaping problem. |
| ja-JP | same, `subset: false` | false | PASS (workaround) — full font embeds and renders correctly, but bloats a 1-page PDF to ~5.7MB per unique CJK font. Not viable for volume production without either a pdf-lib subsetting fix or per-corpus glyph pre-filtering done outside pdf-lib. |
| ar-SA | SFArabic.ttf | true | **FAIL** — glyphs draw without crashing, but pdf-lib does no Arabic shaping: no GSUB contextual joining (isolated/initial/medial/final substitution) and no bidi visual reordering. The string is drawn left-to-right in logical codepoint order starting at the left margin — the mirror image of correct RTL layout. Unusable for real Arabic documents as-is. |

**Verdict:** pdf-lib alone does not clear this gate for ar-SA (needs a
shaping layer, e.g. HarfBuzz, ahead of glyph placement — substantial added
engineering) and clears ja-JP only via an embedding-size tradeoff (full-font
embed) until the subsetter bug is fixed or worked around. th-TH is clean.
This is exactly the "second renderer" condition in the Stage-0 exit gate —
feeds ADR-000 driver 5 / ADR-002 directly; do not treat pdf-lib as the sole
volume renderer without an RTL/CJK follow-up plan.

## Decision
- ADR-000 (authoring model): Path ___ because
- ADR-001 (pagination location): decided / N-A because
- ADR-002 (volume renderer): decided / deferred because
