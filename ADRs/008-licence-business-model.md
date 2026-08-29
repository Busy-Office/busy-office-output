# ADR-008 — Licence

**Status:** Accepted 2026-08-29 — decided directly by the maintainer in chat.
**Deciders:** Repo owner (sole copyright holder — zero external contributors
as of this date, which is what makes this a one-commit decision).
**Blocks (resolved by this ADR):** npm publication; trusted-publishing
provenance; any customer deployment; the README's own "open-source" claim;
the `busy-office-erp → busy-office-output` dependency edge (partially — see
Consequences).

## Context

The repo ships a working document-output runtime and calls itself an
open-source alternative to the output-management stacks bundled inside
commercial ERP suites, but carried no licence. Unlicensed means
all-rights-reserved: evaluation only. Concretely blocked:

1. **Customer implementations** cannot legally run it.
2. **npm publication** — and with it the free Option-B trust tier (trusted
   publishing + automatic provenance), which requires a published package
   from a public repo.
3. **External consumers and contributors** — the stated audience.
4. **The positioning** — "open-source alternative" was false in the legal
   sense.

Not blocked: the owner's own use. The copyright holder can run and develop
against the repo freely; the blockage is that the *product* cannot be
distributed, not that development is stalled.

The strategic question that decides the licence: **is this repo an adoption
engine for the busy-office family, or a moat?** The family has already
answered it three times — `busy-office-ui` is MIT, every contract is
published as `llms.txt` for anyone's AI to read, and the core thesis is that
machine-readable openness *is* the product.

The earlier draft of this ADR (the "Sidekiq rule": everything one company
needs to run its own documents free forever under an OSI licence; paid tier
for operators-of-many — multi-tenant, SSO/SCIM, shadow-parity dashboard,
signed audit exports, retention policy UI, support SLA; self-hosted-first as
the trust posture) is retained as the business-model framing. This ADR
settles the one question that draft left open: the exact OSI licence for
the core.

## Options considered

| Option | Adoption | Protection | Verdict |
|---|---|---|---|
| **Apache-2.0** | Maximum | Explicit patent grant | **Accepted** |
| MIT | Maximum | None | Acceptable — family precedent |
| AGPL-3.0 | Poor — blanket-banned by most enterprise OSS policies | Anti-SaaS copyleft | Rejected: filters out the exact ERP-output-replacement audience |
| BSL / FSL | Moderate | Commercial moat, delayed-open | Rejected: falsifies the open-source positioning for a moat nobody is besieging |
| Stay unlicensed | None | Total (and useless) | Rejected: strictly dominated — see below |

**Why Apache-2.0 over MIT:** the audience is enterprise back-office.
Apache's explicit patent grant is the line item enterprise procurement and
legal review look for on server-side infrastructure; the cost over MIT is a
NOTICE file. Family consistency (ui is MIT) is real but weaker than audience
fit — the two licences are compatible, and mixed MIT/Apache families are
unremarkable.

**Why "stay unlicensed" is strictly dominated:** while the repo has a single
author (or takes contributions only under a DCO), full relicensing freedom
for all *future* versions is retained forever. If a commercial model
materialises later, v-next can be dual-licensed. Permissive-now therefore
closes no future doors, while unlicensed-now closes every present one: no
customers, no npm, no provenance, no contributors. There is no option value
being preserved by deferral — only blockage.

## Rex round

**Challenge 1 — "You are giving away the moat."** A repo with zero stars has
no free-rider problem to defend against; AGPL/BSL solve a success problem
this repo has not earned. The defensible assets are the corpus discipline,
the schema contracts, and velocity — none of which a licence protects.
Sustained.

**Challenge 2 — "Relicensing freedom is a mirage once contributors
arrive."** True without a mechanism; hence the DCO requirement in the action
items. Contributions accepted only with a Developer Certificate of Origin
sign-off keep future dual-licensing legally clean without CLA overhead.
Amended into the decision.

**Challenge 3 — "Licence-accepted will silently flip the erp edge green."**
It must not. The edge carries two independent gates and this ADR resolves
only one. Recorded below as a consequence.

## Decision

Adopt **Apache-2.0** for `busy-office-output`, copyright holder
**Busy Office**, effective from the commit that adds the LICENSE file. Prior
commits remain all-rights-reserved history; nothing is retroactively granted
or needs to be.

## Consequences

- The `busy-office-erp` edge moves from **blocked** to **pinnable for
  development**. It does **not** move to production-green: the Stage-3
  operator-validation gate (`GATE-S3-THESIS-CHECK`, 5 real operators,
  currently N=0) is a separate, still-open condition. Two gates, two
  triggers, no silent banking. (Under ADR-009 the erp edge is an
  architectural precaution, not the current validation path — this
  consequence is recorded for completeness, not as a live priority.)
- npm publication becomes legal → trusted publishing + automatic
  provenance become available → this becomes the second family repo on
  trust tier B at zero cost.
- The README's open-source claim becomes true.
- Future commercial optionality is preserved via DCO-gated contributions
  (dual-licence v-next remains possible).
- Revisit trigger: if a hosted/SaaS offering of this runtime by a third
  party ever materially harms a commercial plan, reopen with evidence — not
  before.

## Action items

1. [x] Commit `LICENSE` (Apache-2.0, 2026, Busy Office as holder).
2. [x] Add `"license": "Apache-2.0"` (SPDX) to every `packages/*/package.json`
   and the root.
3. [x] Add `NOTICE` file (project name, copyright line).
4. [x] Add DCO requirement to `CONTRIBUTING.md` (sign-off line; protects
   relicensing freedom).
5. [x] Update README: replace the "no licence yet — evaluation only"
   paragraph; keep the Stage-3 caveat visible.
6. [ ] Publish `@busy-office/output-*` packages via npm trusted publishing
   (OIDC, provenance on) — **needs the maintainer's npm/OIDC setup; not a
   Claude-doable step.**
7. [ ] In the erp graph: flip the edge amber → pinnable-for-dev; record the
   operator-validation gate as the remaining condition — **lives in the
   busy-office-erp repo, not this one.**
8. [x] Mark ADR-008 **Accepted**.
