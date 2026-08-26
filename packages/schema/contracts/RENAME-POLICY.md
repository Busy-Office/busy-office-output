# Data contract rename-compatibility policy

Applies to every schema in this directory (`purchase-order`, `invoice`,
`payslip`) and to every future `documentType`.

## Versioning

- `schemaVersion` is semver, carried in every `DataContractEnvelope`
  (`packages/schema/src/contract/data-contract.ts`) and pinned per template
  in the registry (`TemplateMeta` does not itself carry it — the
  `DataContractEnvelope` payload does, per event).
- One `schemaVersion` per `documentType`; versions are independent across
  document types.

## What each semver bump means

| Change | Bump | Compatibility rule |
|---|---|---|
| Add an optional field | patch | Old data still validates; new field absent is fine |
| Add a required field with a documented default | minor | Consumers must be updated before the next major; old producers still validate if the field-level default is applied at the boundary, not silently invented downstream |
| **Rename a field** | major | Renaming is never additive — see below |
| Remove a field | major | Removal is a breaking change even if the field was optional |
| Narrow a type or enum | major | e.g. widening `unitOfMeasure`'s enum is minor; narrowing it is major |
| Widen a type or enum | minor | Adding a UNECE Rec 20 code to `unitOfMeasure` is minor |
| Change `money.amount` semantics (e.g. minor units → major units) | major | Money shape changes are always breaking — see CLAUDE.md money convention |

## Renaming a field (the case this policy exists for)

A field is never renamed in place. The sequence is:

1. **Add** the new field name alongside the old one (minor bump). Both are
   accepted; the producer is expected to send the new name, the schema still
   validates payloads carrying only the old name.
2. **Deprecate** the old name in the schema's `description` — do not remove
   it yet.
3. **Remove** the old field name only in a major bump, once the registry
   shows no template/producer still depends on it (a corpus-qa check, not a
   guess).

This is the same reasoning as `TemplateMeta.version` being immutable once
published (`packages/schema/src/document/template.ts`): the contract, once
published against a `schemaVersion`, does not silently drift under existing
consumers.

## Where this is enforced

- Schema files are the source of truth; TypeScript aliases in
  `packages/schema/src/contract/data-contract.ts` (`PurchaseOrderData`,
  `InvoiceData`, `PayslipData`) exist for compile-time ergonomics only —
  they are kept in sync by hand, and typecheck failing on a mismatch is the
  enforcement mechanism until a corpus-qa contract-drift check lands.
- A `documentType` + `schemaVersion` pair, once a template has been
  `published` against it, is immutable in the sense above: further changes
  require a new `schemaVersion`, not an edit to the existing one.
