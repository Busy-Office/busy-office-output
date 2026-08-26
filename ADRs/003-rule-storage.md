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
_Pending. Leaning option 1; the rule TRACE requirement (never fail silently)
holds regardless of storage._
