# Variant resolution spec

Governs how a `VariantKey` (`packages/schema/src/document/template.ts`) picks
one `TemplateMeta` out of many candidates for the same `documentType`, and how
a resolved template's `parentId` chain feeds inheritance. Implementation:
`packages/schema/src/variant/resolve.ts`. Tests:
`packages/schema/src/variant/resolve.test.ts`.

## The key

```ts
interface VariantKey {
  documentType: string;   // always required, exact match
  companyCode?: string;   // "*" when absent
  country?: string;
  partnerId?: string;
  locale?: string;        // BCP-47
}
```

`documentType` is mandatory on every template and always matched exactly.
Every other field is optional on a **candidate** template: an absent field
acts as a wildcard (matches any query value for that field). A query
(`resolveTemplate`'s second argument) is expected to carry concrete values
for whichever fields the caller knows; a query field left absent simply never
matches a candidate that requires that field.

## Most-specific-match rule

1. A candidate **matches** a query iff `documentType` is equal, and for every
   optional field the candidate sets, the query has the same value.
2. Among matching candidates, **specificity** is a weighted score where an
   earlier field in the declared tuple order —
   `(documentType, companyCode, country, partnerId, locale)` — outweighs
   every combination of only later fields. Concretely: `companyCode` is
   worth 8, `country` 4, `partnerId` 2, `locale` 1; a candidate's score is
   the sum for every optional field it sets. This makes a `companyCode`-only
   match (score 8) beat a `country` + `partnerId` + `locale` match (score 7),
   which mirrors the tuple's declared priority order rather than a naive
   field-count.
3. The highest-scoring match wins. **First match wins** on an exact tie
   (same score): resolution is stable on the candidate array's input order,
   so callers that care about tie-breaking control it via how they order
   candidates (e.g. newest-published-first).

## `parentId` inheritance

`resolveTemplate` returns the single winning `TemplateMeta`; it does not
merge template **content** — this package is contracts-only and does not yet
hold template bodies (those arrive in Stage 2). What it does provide is
`resolveParentChain(id, byId)`, which walks `parentId` from the resolved
template up to the root and returns the chain **most-specific first**. The
Stage 2 composition layer merges actual field-level content by walking this
chain child-to-parent, with the child always winning on conflicts — that
merge algorithm is out of scope here; this spec only guarantees the chain is
correctly ordered and cycle-safe (a `parentId` cycle throws rather than
looping forever).

## Worked examples

Candidates (all `documentType: "purchase-order"`):

| id | companyCode | country | partnerId | locale |
|---|---|---|---|---|
| T-global | — | — | — | — |
| T-sg | — | SG | — | — |
| T-sg-en | — | SG | — | en-SG |
| T-acme-sg | 1000 | SG | — | — |
| T-acme-vendorX | 1000 | — | vendor-X | — |

Query `{ documentType: "purchase-order", companyCode: "1000", country: "SG",
partnerId: "vendor-X", locale: "en-SG" }`:

- `T-global` matches (score 0), `T-sg` matches (score 4), `T-sg-en` matches
  (score 5), `T-acme-sg` matches (score 12), `T-acme-vendorX` matches
  (score 10).
- Winner: **`T-acme-sg`** (score 12 — `companyCode` + `country`), even
  though `T-acme-vendorX` also matches two fields, because `companyCode` +
  `country` (8+4=12) outranks `companyCode` + `partnerId` (8+2=10) under the
  declared tuple priority.

Query `{ documentType: "purchase-order", companyCode: "9999", country: "SG" }`
(no candidate sets `companyCode: "9999"`):

- Only candidates that leave `companyCode` a wildcard can match: `T-global`
  (score 0), `T-sg` (score 4), `T-sg-en` — does **not** match, because it
  requires `locale: "en-SG"` and the query has no `locale`.
- Winner: **`T-sg`** (score 4).

Query with no matching `documentType` at all: `resolveTemplate` returns
`undefined` — callers surface this as the "no rule match" failure mode
(HLD §9: error carrying the full evaluated TRACE, never silent). This spec
only defines resolution, not the TRACE format.

## Message templates (GAP-10)

A channel message template — the email subject/body a delivery carries
(`packages/runtime/src/message/message-template.ts`) — is keyed by the same
`VariantKey` and resolved by the same `resolveTemplate` call, against the
same per-firing-rule variant query the document template uses. It is a
second resolution, not a second rule: `resolveTemplate` is generic over
anything carrying `variant: VariantKey`, and the runtime's `determine()`
resolves the message candidates right after the document candidates for
every channel that carries a message (`email`). No match is the
`unresolved-message-template` determination outcome, with every message
candidate in the TRACE — there is no default-subject fallback.
