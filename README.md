# Busy Office Output

ERP document output as it should be: **determination, rendering, archive,
delivery, audit** — an open-source alternative to the output-management
stacks bundled inside commercial ERP suites, renderer-agnostic by design.

**Status: Stage 0 closing.** Nothing here is a product yet. The Stage 0
spike harness has done its job and been deleted; its findings live on in
`docs/RESULTS.md`. ADR-000 (template authoring model) and ADR-001
(pagination location) are both Accepted — schema-first, Typst for
paginated/compliant/non-Latin documents, pdf-direct for simple
high-volume bursts.

## Start here

1. `ROADMAP.md` — stages, gates, kill criteria
2. `docs/RESULTS.md` — the Stage 0 spike findings that decided ADR-000/001
3. `CLAUDE.md` + `.claude/` — this repo is set up for Claude Code: run `claude`, then `/next`
4. `ADRs/` — the open decisions; 000 and 001 are Accepted and shape everything downstream
5. `packages/schema/` — the contracts that survive every path

```bash
npm run verify               # typecheck + tests
```

## One clarification, up front

`busy-office-ui` is a CSS-first, no-build, client-side framework.
**Busy Office Output is a server-side system** — Node runtime, worker pool,
pinned renderer, object storage. They share a brand and a design sensibility
("work never lost, errors where you look"), not a runtime or an audience.
If you arrived expecting a `<link>` tag: wrong repo, right family.
