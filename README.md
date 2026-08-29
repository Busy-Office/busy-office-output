# Busy Office Output

ERP document output as it should be: **determination, rendering, archive,
delivery, audit** — an open-source alternative to the output-management
stacks bundled inside commercial ERP suites, renderer-agnostic by design.

**Status: Stages 0–3 closed, Stage 4 nearly complete (2026-08-29).** The
end-to-end runtime works: `POST /event` → rule trace → Typst render →
PDF/A-2b archive → delivery → complete audit trail, single-process, zero
external services (`npx tsx packages/runtime/src/index.ts`, or the
`Dockerfile`). Three document types (purchase order, invoice, payslip),
a read-only console at `/output`, retention enforcement, and
document-level authorization are built and tested. **Not yet validated by
real operators** — Stage 3's thesis check (show the demo to 5 real
operators) is still open. **Licensed Apache-2.0** (ADR-008, accepted
2026-08-29; see `LICENSE`, `NOTICE`, and the DCO requirement in
`CONTRIBUTING.md`). ADR-000
(authoring model) and ADR-001 (pagination) are Accepted — schema-first,
Typst for paginated/compliant/non-Latin documents; ADR-002 (volume
renderer) is still open on stale numbers.

## Start here

1. `ROADMAP.md` — stages, gates, kill criteria
2. `docs/RESULTS.md` — the Stage 0 spike findings that decided ADR-000/001
3. `CLAUDE.md` + `.claude/` — this repo is set up for Claude Code: run `claude`, then `/next`
4. `ADRs/` — the open decisions; 000 and 001 are Accepted and shape everything downstream
5. `packages/schema/` — the contracts that survive every path

```bash
npm run verify               # typecheck + tests
```

## Three numbers (ROADMAP.md, published from Stage 2 onward)

Measured warm, in-process, `n=20` timed runs (3 untimed warmup runs first —
each `typst compile` shell-out pays a one-time OS/font-cache cost) via
`npm run bench:po`.

| Renderer | Document type | Corpus case | p50 | p95 | Hardware |
|---|---|---|---|---|---|
| `typst` (`@busy-office/render-typst`) | purchase-order | 001-single-page | ~123ms/doc | ~136ms/doc | MacBook Air, Apple M4, 24 GB RAM, macOS 26.5.2 (25F84) |
| `pdf-direct` (`@busy-office/render-pdf-direct`) | purchase-order | 001-single-page (no-carry-forward tree, `test/corpus/pdf-direct/`) | ~16ms/doc | ~18ms/doc | MacBook Air, Apple M4, 24 GB RAM, macOS 26.5.2 (25F84) |
| `pdf-direct` (`@busy-office/render-pdf-direct`) | payslip | 001-single-page | ~16ms/doc | ~17ms/doc | MacBook Air, Apple M4, 24 GB RAM, macOS 26.5.2 (25F84) |

pdf-direct rows: `npm run bench:pdf-direct`, same n=20/warmup=3 protocol,
in-process `pdf-lib` with embedded DejaVu Sans subset + XMP + OutputIntent
(PDF/A-2b, veraPDF-clean in the corpus gate). Same data and corpus case as
the Typst purchase-order row, but the pdf-direct tree carries no
`carryForward` (its routing rule excludes it), and the two are different
kinds of work (in-process vs. a `typst compile` shell-out). Both are the
wall time a `Renderer.render()` caller waits for. Not comparable to Stage
0's pdf-direct spike number (38ms/doc container, 12.1ms/doc on this
hardware, `docs/RESULTS.md`): that spike embedded no font and was not
PDF/A.

The Typst row is not comparable to Stage 0's pdf-direct spike number
either (38ms/doc, container, `docs/RESULTS.md`) — different renderer,
different measurement context
(shell-out to `typst compile` vs. in-process `pdf-lib`). Pagination pass
rate: 7/7 corpus cases green (`test/corpus/purchase-order/`), including the
overflow-must-fail case failing loudly as required.

## One clarification, up front

`busy-office-ui` is a CSS-first, no-build, client-side framework.
**Busy Office Output is a server-side system** — Node runtime, worker pool,
pinned renderer, object storage. They share a brand and a design sensibility
("work never lost, errors where you look"), not a runtime or an audience.
If you arrived expecting a `<link>` tag: wrong repo, right family.
