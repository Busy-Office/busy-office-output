# Session log

Newest first. One entry per Claude Code session. Template:

```
## YYYY-MM-DD — Stage N
- Did: <task> — evidence: <command → result>
- Open: <anything half-finished, or "nothing">
- Next: <recommended pickup>
```

---

## 2026-08-26 — Stage 0 (loop tick 1)
- Did: Q1 bootstrap — `npm install` root + spike/pdf-direct (lockfiles
  committed, 0 vulns in prod deps); `npm run verify` green; `spike:data`
  run twice → byte-identical sha256 across both runs on this machine.
- Open: Q2 (pdf-direct bench on this Mac) next.
- Next: Q2 — render-engineer runs `npm run spike:pdf-direct`, fills
  RESULTS.md hardware section + gate-5 pdf-direct row.

## 2026-08-26 (later) — design consolidation (container)
- Did: docs/HLD.md landed in-repo (topologies T1-T3 + transactional outbox,
  RenderJob seam, standards-aware renderer routing); docs/UI-DESIGN.md (five
  principles, 6 sections / 11 screens, screen one-liners, absent-list);
  ADR-007 packaging (Proposed, drafted), ADR-008 licence (Proposed, stub);
  ROADMAP gained commercial gates C1-C3 + parking rule, console tasks in
  S3/S4/S5, embeddable-module+outbox task, thesis check; new agent
  console-designer; CLAUDE.md read order + UI rule.
- Open: unchanged Stage 0 human tasks (carbone bench, hardware re-measure,
  CCL read, ADR-000); ADR-008 is human-only.
- Next: still the carbone template + bench — nothing above unblocks without it.

## 2026-08-26 — Stage 0 (scaffold session, container)
- Did: repo scaffolded; pdf-direct spike implemented+verified (3 pages,
  p50=37.8ms, carried/brought-forward chain confirmed on rasterized page 2);
  typst spike implemented+verified (state-based running footer works,
  cold-process p50≈459ms); carbone harness + TEMPLATE.md ready (needs
  LibreOffice); schema contracts typecheck under --strict; ADRs 000–004
  drafted; Claude Code layer added (CLAUDE.md, 4 agents, 4 commands, settings).
- Open: carbone spike unrun; RTL/CJK smoke test; hardware re-measure; CCL
  licence read; ADR-000 undecided.
- Next: /next will point at authoring po-template.odt and running the carbone
  bench — that is the human-hardware task everything waits on.
