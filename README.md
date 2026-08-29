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
operators) is still open. **No licence yet — evaluation only** (ADR-008
open); this repo is not yet legally usable beyond looking. ADR-000
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

Not comparable to Stage 0's pdf-direct spike number (38ms/doc, container,
`docs/RESULTS.md`) — different renderer, different measurement context
(shell-out to `typst compile` vs. in-process `pdf-lib`). Pagination pass
rate: 7/7 corpus cases green (`test/corpus/purchase-order/`), including the
overflow-must-fail case failing loudly as required.

## One clarification, up front

`busy-office-ui` is a CSS-first, no-build, client-side framework.
**Busy Office Output is a server-side system** — Node runtime, worker pool,
pinned renderer, object storage. They share a brand and a design sensibility
("work never lost, errors where you look"), not a runtime or an audience.
If you arrived expecting a `<link>` tag: wrong repo, right family.
