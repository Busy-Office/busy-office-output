# ADR-003 — Output rule storage

**Status:** Proposed. Closes in Stage 3.

## Context
Rules resolve (event, payload) → (template, locale, channel, recipients).
Git-versioned config files are diffable, reviewable, and match the
developer-first positioning; DB tables allow runtime editing by business
users but need their own change governance.

## Options
1. Files first; table-backed adapter later if a real user demands runtime edits
2. Tables first
3. Both from day one — rejected: two sources of truth before there is one user

## Decision

**Accepted 2026-08-28: Option 1 (files first).**

Git-versioned config files: diffable, reviewable, matches the
developer-first positioning. A table-backed adapter is deferred, not
rejected — it can be added later behind the same rule-storage seam if a
real user demands runtime edits by non-developers, without a rewrite of
rule evaluation itself. The mandatory rule TRACE requirement (every
non-match is an error carrying the full evaluated trace, never a silent
no-op — HLD §9) holds regardless of storage backend, so this choice does
not weaken auditability.

Decided directly by the maintainer in chat, 2026-08-28, no new evidence
against the ADR's own original leaning — accepted as drafted.
