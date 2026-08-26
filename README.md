# Busy Office Output

ERP document output as it should be: **determination, rendering, archive,
delivery, audit** — an open-source alternative to the output-management
stacks bundled inside commercial ERP suites, renderer-agnostic by design.

**Status: pre-Stage-0.** Nothing here is a product yet. The spike harness is
built, two of three candidate renderers are verified, and the first decision
(ADR-000, template authoring model) is open.

## Start here

1. `ROADMAP.md` — stages, gates, kill criteria
2. `spike/README.md` — run the Stage 0 bake-off on your hardware
3. `CLAUDE.md` + `.claude/` — this repo is set up for Claude Code: run `claude`, then `/next`
4. `ADRs/` — the five open decisions; 000 comes first and shapes everything
5. `packages/schema/` — the contracts that survive every path

```bash
npm run spike:data          # regenerate the reference 120-line PO
npm run spike:pdf-direct    # verified: ~38ms/doc p50 (container)
npm run spike:typst         # verified: needs typst binary
npm run spike:carbone       # needs LibreOffice + authored template
```

## One clarification, up front

`busy-office-ui` is a CSS-first, no-build, client-side framework.
**Busy Office Output is a server-side system** — Node runtime, worker pool,
pinned renderer, object storage. They share a brand and a design sensibility
("work never lost, errors where you look"), not a runtime or an audience.
If you arrived expecting a `<link>` tag: wrong repo, right family.
