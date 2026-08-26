# Stage 0 results — THE record that outlives spike/

> Moved from `spike/RESULTS.md` on 2026-08-27 when Stage 0 closed per its
> own exit gate ("delete `spike/` except `RESULTS.md`, move it to
> `docs/`"). The `spike/pdf-direct/`, `spike/typst/`, `spike/carbone/`,
> and `spike/data/` code this document's reproduce-commands reference no
> longer exists in the working tree — it's preserved in git history at
> or before commit `0a9424e` if it's ever needed again. This file itself
> is the durable record; the harnesses were disposable by design
> (`spike/README.md`, now also deleted).

> Container pre-run 2026-08-26 (indicative): pdf-direct p50=37.8ms p95=74.6ms (3 pages, 25KB);
> typst cold-process p50=459ms (3 pages); carbone not run (no LibreOffice in container).
> All numbers below must be re-measured on the target hardware.

## Hardware / environment
- Machine: MacBook Air, Apple M4, 24 GB RAM, macOS 26.5.2 (25F84)
- Node / Typst / LibreOffice versions: Node v26.3.0; Typst 0.15.1 (GATE-TYPST-INSTALL answered — installed via brew); LibreOffice not installed (GATE-CARBONE)

## Gate matrix (pass / fail / notes)

| Gate | carbone | typst | pdf-direct |
|---|---|---|---|
| 1 header repeats | | PASS (container) | PASS (container) |
| 2 carry-forward subtotal | | PASS (container) | PASS (container) |
| 3 totals never split | | PASS (container) | PASS (container) |
| 4 wrap, no silent clip | | PASS (container) | PASS (container) |
| 5 ms/doc (p50 warm) | | PASS — cold-process p50=100ms min=98ms max=106ms (n=15, 3 pages); note DejaVu Sans font warning, see Authoring notes | PASS — p50=12.1ms p95=14.5ms mean=12.3ms (n=30, 3 pages, 25KB) |

## Bursting math
**Target window: 30 minutes for 8,000 docs (GATE-BURST-WINDOW, closed
2026-08-27, maintainer decision).** Chosen because it's the point where
both candidate renderers clear the window on a single process, with no
worker-pool fan-out needed yet: pdf-direct at 18.6x margin, Typst
(cold, single-process) at ~2.25x margin. Under ADR-001, Typst now owns
pagination for multi-page/carry-forward/non-Latin documents — exactly the
shape of a real 8,000-doc batch (month-end invoices, payslips), not just
pdf-direct's simple fast-path cases — so Typst's own margin, not just
pdf-direct's, was the deciding constraint. Defers worker-pool/fan-out
investment (Stage 3+ territory) until a real customer SLA demands a
tighter window than 30 minutes. Parametrized against all four candidate
windows below for the record:

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
not the bottleneck at any plausible window** — carbone still needed
(GATE-CARBONE) before this table is complete.

Typst measured (cold-process p50=100ms — `run.sh` spawns a fresh `typst
compile` per doc; a warm/watch-mode server would be faster but wasn't
measured): 8,000 docs ≈ 800s (13.3 min) single-process, cold. Against the
required-ms/doc table above: does **not** clear the 5-min window
single-process (100ms actual > 37.5ms required); clears 15-min with a
thin ~1.1x margin (100ms vs 112.5ms required); clears 30-min comfortably
at 2.25x margin (100ms vs 225ms required). *(Correction 2026-08-27: the
prior text here claimed Typst clears 5/15-min windows at "3x/9x margin" —
that doesn't reconcile with the required-ms/doc table and was likely a
copy error from pdf-direct's row; recomputed directly above. Not
load-bearing for the 30-min decision either way, since 30-min is the
window actually chosen.)* Would need parallelism or a warm-process mode
to clear tighter windows than 30 min the way pdf-direct does.

**achieved (30-min target): typst 100ms p50 cold — 2.25x margin (clears) /
pdf-direct 12.1ms p50 — 18.6x margin (clears) / carbone not applicable —
reserved, not adopted, per ADR-000.**

## Authoring experience notes (feeds ADR-000)
- Carbone (.odt in LibreOffice):
- Typst (markup): `po.typ` requests `font: "DejaVu Sans"`, not installed on
  this Mac — typst silently substitutes a fallback and warns on every
  compile ("unknown font family: dejavu sans"); ms/doc unaffected, but the
  reference PO isn't rendering in its intended font here. Same font-fallback
  behavior that made the RTL/CJK Arabic+digit case pass (see below) — a
  double-edged trait: convenient, but a missing font is a silent warning,
  not a build failure, so a typo'd font name in production wouldn't be
  caught without a lint step.
- Who will actually author templates at the target org?

## Licence check
- Carbone CCL read in full? Compatible with intended distribution? Y/N + notes:

## RTL / CJK smoke test (do NOT defer to Stage 6)
Both candidates measured on this Mac (Apple M4). Fonts: macOS system fonts,
smoke-test only — not licensed for redistribution; production needs
bundled/licensed fonts regardless of outcome here.

**Correction (same session, tick 5):** the pdf-direct row below was first
written after eyeballing a small combined 3-line thumbnail and wrongly
concluded pdf-lib does no Arabic bidi/shaping at all. A rigorous recheck —
isolated single-line renders, explicit-codepoint two-letter order test,
pixel-cluster analysis comparing rendered glyph x-positions against source
codepoint order — showed that conclusion was **wrong**: pdf-lib (via
fontkit, when a custom font is embedded) does correct bidi reordering and
Arabic contextual joining, matching Typst's output almost exactly. The real,
narrower defect is below. Lesson: pixel-level claims need pixel-level
verification, not a glance at a thumbnail — kept here rather than silently
overwritten.

pdf-direct: two of the three system fonts (Thai, Japanese) ship as `.ttc`
collections; pdf-lib/fontkit cannot embed a `.ttc` directly, so
`spike/pdf-direct/ttc-split.js` extracts one face as a standalone sfnt first
(binary table-directory copy, no resampling). Reproduce:
`npm run spike:rtl-cjk`, rasterize `spike/pdf-direct/out-rtl-cjk-smoke.pdf`.
Typst: reproduce with `typst compile --root . spike/typst/rtl-cjk-smoke.typ spike/typst/out-rtl-cjk-smoke.pdf`.

| Script | Case | pdf-direct (pdf-lib) | Typst |
|---|---|---|---|
| th-TH | ใบสั่งซื้อ... (Thonburi) | **PASS** — renders correctly, combining marks stack right | **PASS** |
| ja-JP | 発注書... (Hiragino W3, `subset: true`) | **FAIL** — tofu; poppler "Embedded font file may be invalid". pdf-lib's TrueType subsetter breaks on this font's 20,339 glyphs / composite components — a subsetting bug, not shaping | **PASS** |
| ja-JP | same, `subset: false` | PASS (workaround) — full font embeds correctly but bloats output to ~5.7MB for one CJK font on a 1-page PDF | PASS, and cheap: Typst's own combined 3-script PDF is **21KB total** (vs pdf-lib's 5.8MB) — Typst subsets CJK correctly, no bug, no size tradeoff |
| ar-SA | أمر شراء... pure Arabic (SF Arabic) | **PASS** — bidi reordering and GSUB contextual joining both correct (verified: source codepoint order SEEN-then-YEH renders YEH-left/SEEN-right, i.e. first-logical-char rightmost; full sentence word order matches Typst pixel-for-pixel) | **PASS** |
| ar-SA | السعر 1234.50 ريال... Arabic + Latin digits (real invoice shape) | **FAIL** — Arabic words reorder/join correctly, but "1234.50" and "ABC" render as `.notdef` boxes. Root cause confirmed at the font level: `fontkit.create(...).glyphForCodePoint('1'.codePointAt(0)).id === 0` — **SFArabic.ttf genuinely has no Latin/digit glyphs** (a macOS "companion" font meant to be paired with a Latin font by the OS's font-fallback chain). pdf-lib has **no font-fallback mechanism** — pick an incomplete font and missing glyphs silently become boxes | **PASS** — same font (`"SF Arabic"` requested explicitly), same missing glyphs in that font, but Typst automatically falls back to another available font for the codepoints SF Arabic lacks. Renders correctly with zero extra code. |

**Verdict:** pdf-lib's Arabic bidi/shaping is fine on its own — the earlier
"needs HarfBuzz" framing was wrong and is retracted. The real, narrower gaps
are (1) a TrueType subsetter bug on large composite-glyph CJK fonts
(workaround: disable subsetting, at a real size cost, until fixed upstream)
and (2) no font-fallback chain, which bites as soon as a document mixes
scripts with numbers/Latin text in one font — the normal case for real
invoices/POs, not an edge case. Typst has neither gap in this test. This
still feeds ADR-000 driver 5 / ADR-002: not "pdf-lib can't do RTL" but
"pdf-lib needs either a complete-per-script font set assembled by hand (no
fallback) or a subsetting fix/workaround for CJK volume," which is real
added engineering cost pdf-lib carries and Typst doesn't, in this test.

## Decision
- ADR-000 (authoring model): Path ___ because
- ADR-001 (pagination location): decided / N-A because
- ADR-002 (volume renderer): decided / deferred because
