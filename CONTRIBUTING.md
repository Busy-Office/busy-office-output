# Contributing

Thanks for considering a contribution. Two things are non-negotiable
before code is discussed.

## 1. Developer Certificate of Origin (DCO) — required on every commit

This project accepts contributions only with a DCO sign-off. This is what
keeps the project's licensing clean (ADR-008): it certifies you have the
right to submit the work under the project's licence, without the overhead
of a CLA.

Add a `Signed-off-by` line to every commit, matching your git identity:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it automatically. By signing off you certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the contribution (or have the right to submit it), and that
you understand it is public and licensed under this project's licence
(Apache-2.0, see `LICENSE`).

Commits without a sign-off will not be merged.

## 2. Gates are commands, not opinions

Read `CLAUDE.md` — it is the project's working agreement, not just an AI
prompt. In particular:

- `npm run verify` must pass (typecheck + the full corpus, which shells out
  to `typst`, `verapdf`, and `pdftotext` — see `.github/ci/install-tools.sh`
  for the pinned versions CI uses).
- A ROADMAP.md checkbox is ticked only when its stated Definition of Done
  was actually witnessed — a command run, output seen.
- The Deferred table at the bottom of ROADMAP.md is a wall: do not scaffold,
  stub, or "prepare for" anything on it.
- Never log a data-contract payload (payslips are PII). Hashes and rule
  traces only — `packages/runtime/src/embed/payslip-log-scrub.test.ts`
  enforces this.
- `@busy-office/output-schema` stays zero-runtime-dependency.

Design decisions live in `ADRs/`. If your change needs one, open the ADR
first; only the maintainer accepts ADRs.
