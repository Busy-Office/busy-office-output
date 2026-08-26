# Stage 1 paper test — result

**PASS**, 2026-08-27. Evidence:
`packages/schema/src/document/paper-test.test.ts` (`npm test`).

## What was tested

Purchase order and invoice templates, written as `DocNode` trees
(`packages/schema/src/document/nodes.ts`) against the Stage 1 contracts
(`packages/schema/contracts/purchase-order.schema.json`,
`invoice.schema.json`) and the Stage 1 expression grammar
(`docs/EXPRESSION-GRAMMAR.md`).

## Result

- **Zero new node kinds needed.** Both templates use a subset of the nine
  frozen kinds: `document`, `header`, `fieldGrid`, `text`, `section`,
  `table`, `totals`, `footer`, `pageNumber`. This is enforced structurally —
  `DocNode` is a closed union, so a template needing a tenth kind would fail
  TypeScript compilation, not just a manual review.
- **Zero new expression syntax needed.** Every bound `value`/`bind`/`key` in
  both trees parses under the existing grammar: envelope-rooted paths
  (`header.poNumber`, `totals.grandTotal.amount`, `lines`) and row-relative
  table-column keys (`netAmount.amount`, `quantity`). No function calls, no
  indexing, no operators were needed for either document type.
- Invoice's `table.carryForward: 'netAmount.amount'` exercises the one
  invoice-specific field (`carryForward`) that PO's table omits — still
  within the nine kinds, no new field needed either.

## Gate

Roadmap Stage 1 exit gate item "Paper test passes" — **satisfied**. This
does not by itself close the Stage 1 exit gate (`/gate-check 1` also
requires `npm run verify` green and ADR-001 closed/moot — both already
true), but it is the direct DoD evidence for that checklist item.
