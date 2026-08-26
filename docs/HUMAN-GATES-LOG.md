# Human gates log

Append-only. The loop logs a gate and continues; the human answers in
`docs/INBOX.md` (reference the gate ID). Status: open / answered / closed.

| Gate | Needs | Evidence for the human | Logged | Status |
|---|---|---|---|---|
| GATE-TYPST-INSTALL | `brew install typst` on this Mac | needed for gate-5 typst row + RTL/CJK typst column | 2026-08-26 | open |
| GATE-BURST-WINDOW | the stated bursting window (minutes for 8,000 docs) | RESULTS.md bursting table will be filled per candidate window | 2026-08-26 | open |
| GATE-CARBONE | author po-template.odt + LibreOffice, or write "skip carbone" in INBOX | RESULTS.md gate-matrix carbone column; blocks ADR-000 draft | 2026-08-26 | open |
| GATE-S1-PREWORK | may the loop do path-independent Stage 1 tasks while Stage 0 is human-blocked? default NO | see docs/LOOP-PLAN.md | 2026-08-26 | open |
| GATE-RTL-SHAPING | pdf-lib alone fails ar-SA (no bidi/GSUB shaping) and only clears ja-JP by disabling subsetting (~5.7MB/font); decide: pair pdf-lib with a shaping layer (e.g. HarfBuzz bindings), name a second renderer for RTL/CJK volume docs, or defer non-Latin scripts out of Stage 0 scope | spike/RESULTS.md RTL/CJK section; reproduce with `npm run spike:rtl-cjk` | 2026-08-26 | open |
