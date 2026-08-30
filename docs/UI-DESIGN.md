# Console UI design

Design record for the Busy Office Output console. Built as busy-office-ui
pages mounted at `/output` in a host app, or served by `bo-output serve`.

## Principles (every screen must pass all five)

1. **One-sentence test** — the whole screen describable in one sentence.
2. **Errors where you look** — failures render on the element/row that
   failed; no corner counters, no gate chips. Quiet when green.
3. **One primary action per screen.**
4. **Depth ≤ 2** — section → drill-in, never deeper.
5. **One modality per screen** — a screen edits by conversation OR by form,
   never both; source editing belongs to the user's own editor.

## Information architecture — 6 sections, 11 screens

| Section | Screens | Primary action | Lands with |
|---|---|---|---|
| Overview | failures-first home | jump to failure | Stage 5 |
| Documents | registry · document detail (reprint trichotomy) | reproduce | Stage 3 |
| Templates | list (variants+lifecycle) · workspace · review-and-approve | accept as draft / approve | S5 list, S7 workspace, S5 review |
| Rules | read-only rules · event log → trace | open trace | Stage 3 |
| Operations | delivery queue · shadow parity | retry delivery | S4 queue, parity with shadow track |
| Settings | four flat groups (channels, retention, renderers, access) | — (read-only; a config store would need an ADR) | Stage 5 |

Cross-links: overview failure → document/delivery · registry poison →
operations · document detail → trace · sample drop (anywhere in Templates) →
workspace converging · review publish → templates.

## Screen specs (one sentence each)

- **Overview**: every current failure, each row a link (worst-first;
  templates awaiting approval last); nearly empty on a good day, by design.
- **Registry**: one search box over every document ever, bordered rows with
  state stamp, template@ver · renderer@ver, delivery status; payslip rows
  carry their ACL visibly (lock).
- **Document detail**: the artifact's identity (PDF/A badge = veraPDF in CI,
  hashes, retention date) and the reprint trichotomy — Reproduce (archive
  bytes, stamped) / Regenerate (current template+data, new doc) / Reissue
  (new event) — any action records who, why, stamp (rendered inline via an
  A4-styled frame, an unaudited passive view distinct from Reproduce).
- **Rule trace**: skipped rules with the failing condition shown, the matched
  rule with evaluated values, the resolution; the same trace is the
  problem+json body on no-match.
- **Templates list**: variant tree (indent = inherits), lifecycle badges;
  drop a sample PDF anywhere to generate (ADR-005).
- **Workspace** (the builder): a document, what changed (proposed tint, hold
  to compare), what it costs (one impact line: pages · gates · blast radius),
  a prompt, and Accept as draft. Nothing else. Source/history behind ⌘K and
  the user's editor. Generation is this same screen in a converging state.
- **Review-and-approve**: current vs proposed (structural DocNode diff
  against the live same-variant version — S7 reuses it), blast radius,
  mandatory reason, one primary per phase: Approve in review, Publish in
  approved, never both — the Stage 5 gate as a screen.
- **Operations**: delivery rows (retry n / poison / sent) — retry never
  re-renders; shadow parity strip with the cutover gate (≥ target for N
  consecutive days).
- **Settings**: config that changes yearly, not daily; four flat groups, no
  drill-ins. Read-only: every value is set at process start.

## Deliberately absent (additions here require an arb-chair ruling)

No rule editor (files own rules, ADR-003). No drag-drop canvas builder
(ADR-005 replaces it). No dashboard-of-dashboards. No shortcut tutorial
chrome. No permanent history rail. No renderer pickers in session chrome
(renderer is a template property). No tree/outline/inspector editor
(GAP-04's builder, reaffirmed by GAP-18's rejection of the "DocNode
projection editor" proposal 2026-08-30 — violates principle 5, source
editing stays in the user's own editor).

## Fidelity trail

Wireframes → grilled simplification (15 controls → 5 on the workspace) →
mockups for registry, detail, trace, parity → flow map + skeletons for the
remaining five. Mockups exist in design sessions; commit as `docs/mockups/`
when console work starts (Stage 3), not before.
