# Expression grammar (Path A)

Governs the `value`/`bind`/`key` strings in `DocNode`
(`packages/schema/src/document/nodes.ts`). Implementation:
`packages/schema/src/expression/parse.ts`.

There are two contexts, sharing one syntax:

- **Envelope-rooted** — `text.value`, `fieldGrid.fields[].value`,
  `table.bind`, `totals.rows[].value`. The path's root must be a known
  `DataContractEnvelope` key (see below). Validated by `parseExpression`.
- **Row-relative** — `table.columns[].key`. A `table` node's `bind` already
  addresses the bound array (envelope-rooted); each column's `key` is a path
  *within one array element*, so it has no envelope root to check against —
  any syntactically valid path is accepted. Validated by
  `parseRelativePath`. (`textalign`/`width`/`label` on a column are not
  expressions at all — plain strings/numbers.)

Per HLD §7: **allowlisted grammar, no eval, no imports, no I/O.** This grammar
precedes the parser — the parser implements exactly what is written here, and
nothing else. Extending the grammar (adding a function, an operator) is a
grammar-doc change first, then a parser change — never the reverse.

## Grammar (v1)

```
expression := path
path       := identifier ( '.' identifier )*
identifier := [a-zA-Z_][a-zA-Z0-9_]*
```

An expression is a dot-separated field path into the bound
`DataContractEnvelope` — e.g. `header.poNumber`, `totals.grandTotal.amount`,
`lines`. There are no operators, no literals, no function calls, and no
indexing (`lines[0]` is not valid — a `table` node's `bind` addresses the
whole array; the renderer iterates it, the expression grammar does not).

This is deliberately minimal. Nothing in the Stage 0 spikes or the Stage 1
paper test needed more; the grammar grows only when a real template proves it
needs to, via a grammar-doc change reviewed the same way ADR-005 reviews any
template change (corpus gates, provenance).

## Publish-time identifier allowlisting

For an envelope-rooted expression, the path's **root identifier** (the first
segment) must be one of the envelope's known top-level keys: `schemaVersion`,
`documentType`, `header`, `lines`, `totals`. Anything else — a typo, a field
that doesn't exist on the envelope, an attempt to reach outside the bound
data — is rejected **at publish time** (when a template moves from
`draft`/`review` into `published`/`approved`), never silently accepted and
left to fail at render time. A row-relative path (`table.columns[].key`) has
no root to check — a `table` binds a `documentType`-specific array, and this
package does not know a column key's validity without that context; it can
only reject malformed *syntax*.

The parser (`parseExpression` / `parseRelativePath`) validates syntax, and
`parseExpression` additionally validates the root identifier against the
fixed allowlist above; neither validates the full path against a specific
`documentType`'s JSON Schema (e.g. that `header.invoiceNumber` is invalid for
a `purchase-order` template) — that schema-aware check is a natural Stage 2
extension once composition binds a template to a concrete `documentType`,
not a Stage 1 requirement.

## No eval, no imports, no I/O

There is nothing in this grammar that could express any of those — no
function-call syntax exists to smuggle one in, and the parser has no
fallback "anything else is treated as JavaScript" path. An unparseable
string is a rejected template, not a partially-interpreted one.
