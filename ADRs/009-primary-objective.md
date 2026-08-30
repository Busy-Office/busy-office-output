# ADR-009 — Primary objective: standalone product

**Status:** Accepted 2026-08-29 — decided directly by the maintainer in chat.

## Context

ADR-007's Boundaries section holds two objectives at once — "busy-office-erp
is consumer #1, never owner" describes an ERP-subsystem framing, while the
project's own README/CLAUDE.md language ("open-source alternative to
commercial ERP output-management stacks") describes a standalone product.
`busy-office-erp` (an ERP consumer prototype) has existed on this
maintainer's machine as `busy-office-erp-poc`, but is now in an `__archived/`
directory — it is not an active dependency of this decision, and no active
consumer repo exists.

Gap register (chat-derived 2026-08-29, GAP-01) named this as the single
highest-priority unratified decision: everything downstream — the shape of
the consumer contract (GAP-07), whether the audit spine is optional
(GAP-02), and whether Stage 5 can proceed before Stage 3's thesis-check gate
closes (GAP-13) — depends on knowing which objective this project is
actually pursuing.

## Decision

**Standalone product.** `busy-office-erp-poc` is dead — confirmed directly
by the maintainer, not resurrected as consumer #1. The primary objective is
an operator-facing, standalone ERP document output runtime: the thesis
CLAUDE.md and README already state (determination + archive + audit as the
underserved layer, rendering as commodity), validated by real operators
using the product directly, not by a sibling ERP module consuming its API.

**Next milestone: the operator demo, not "first module wired through the
API."** `GATE-S3-THESIS-CHECK` (`docs/HUMAN-GATES-LOG.md`) — showing the
already-built, already-verified Stage 3 end-to-end demo to 5 real operators
and writing up `docs/PREMORTEM.md` — is the validation this decision points
at. This does not newly block Stage 4/5 work (see GAP-13's own note: a
ratified exception may let Stage 5 proceed unvalidated), but it does settle
what "validated" means going forward: real standalone-product usage, not
integration-contract adoption.

**Amended 2026-08-30:** `GATE-S3-THESIS-CHECK`'s formal pre-registered
5-operator scoring mechanism is voided (docs/GAP-REGISTER.md GAP-13) — it
was judged the wrong mechanism for a solo maintainer, not a wrong goal.
What "validated" means going forward is unchanged from the paragraph
above (real standalone-product usage, by real operators, not integration-
contract adoption); only the formal gate-and-scoring apparatus around
proving it is gone. Validation now happens informally/continuously as
real operators are encountered, with no pre-registered scoring sheet or
blocking gate.

## Consequences

- ADR-007's "consumer #1" framing is retained as an ARCHITECTURAL
  precaution (embeddable module topology stays real and tested — a future
  ERP or other host integration remains possible without a rewrite), not as
  the project's current validation path. `packages/runtime/src/embed/
  create-output.ts` (`createOutput()`) stays built and tested; it is simply
  not what "success" is measured against right now.
- GAP-02 (spine scope) and GAP-04 (template authoring persona) are decided
  in the same session, consistent with this objective — see their own
  gap-register entries and this session's chat log for the ratified
  answers.
- `busy-office-ui` (a separate, active sibling project on this maintainer's
  machine — a real design-system product, not a package this repo
  imports) is the product this console's visual idiom deliberately
  diverges from, per CLAUDE.md's existing risk note. This ADR does not
  change that relationship.
