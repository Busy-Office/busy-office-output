# Stage 0 spike — decide whether (and what) to build

Three renderers, one identical document, one decision. Everything here is
disposable except `RESULTS.md`, which survives as the record of why ADR-000
and ADR-001 were decided the way they were.

## The document

`data/reference-po-120-lines.json` — regenerate with `node data/generate.js`
(deterministic, seeded). 120 line items, mixed description lengths, SGD, 9% GST.

## The gates (all three renderers, same checklist)

1. Column header repeats on every page
2. Carried-forward subtotal at each page break, brought forward on the next
3. Totals block never splits across a page boundary
4. Long descriptions wrap; nothing clips silently
5. ms/document, measured warm, on the hardware that will run production

## The three spikes

| | Path | Run | Status |
|---|---|---|---|
| `carbone/` | B — office template | author `po-template.odt` per `TEMPLATE.md`, then `npm i && npm run bench` (needs LibreOffice) | harness ready, needs template + LO |
| `typst/` | A — markup engine | `./run.sh` (needs typst binary) | **verified**: gates 1–4 pass, incl. running-total footer via `state()` |
| `pdf-direct/` | A — volume renderer | `npm i && npm run bench` | **verified**: gates 1–4 pass, 3 pages |

Pre-measured in a container (indicative only — re-run on real hardware):

- `pdf-direct` (pdf-lib, in-process): **p50 ≈ 38ms / doc**
- `typst` (cold process per compile): **p50 ≈ 459ms / doc** — cold-start dominated;
  a warm/batched mode needs its own measurement before comparing
- `carbone`: unmeasured here (no LibreOffice in the container); Carbone's own
  published figure is ~50ms/doc with 3 warm LO workers

## Kill / decide criteria

- If Carbone passes gates 1, 3, 4 and its authoring experience is acceptable,
  and gate 2 (carry-forward) is either achievable or not actually required →
  **ADR-000 leans Path B** and Stages 1–2 shrink accordingly.
- If gate 2 is a hard requirement office formats can't meet → Path A, and the
  Typst-vs-(compose+pdf-direct) choice becomes ADR-001/002.
- If nothing here can hit the bursting window (8,000 docs inside your stated
  SLA) on real hardware → stop and rethink before writing any product code.

Fill `RESULTS.md` as you go. Delete everything else in `spike/` when Stage 0 closes.
