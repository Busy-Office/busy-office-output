/**
 * ArchiveStore port — mandatory `retentionUntil`; archiving without
 * retention fails. This is the seam the Delivery queue reads archived
 * bytes back through, and what the registry's `archiveRef` column is a
 * pointer into.
 *
 * HLD: an Artifact's `retentionUntil` is mandatory — payslip retention is
 * not purchase-order retention, and there is no such thing as an archived
 * artifact with no retention policy. `retentionUntil` is therefore a
 * required parameter at the TypeScript type level (not `retentionUntil?:`)
 * AND validated at runtime by every implementation via
 * `assertValidRetentionUntil` below, so a caller that manages to pass
 * `undefined`/`null`/garbage through a JS boundary (no compiler, a bad
 * upstream cast, a test) still fails loudly instead of silently archiving
 * an artifact nothing will ever purge.
 *
 * `purge` is the retention-enforcement half: it deletes the bytes an
 * `archiveRef` points to, for a caller (`archive/retention-enforcement.ts`)
 * that has already decided — by reading `retentionUntil` back off the
 * registry row, never off this port — that they are past their retention
 * deadline. This port stays a dumb bytes-store: it does not read clocks,
 * does not decide who is expired, and does not touch the registry; all of
 * that judgment lives in `retention-enforcement.ts`.
 * NOT here: delivery, channels, rule determination — separate seams.
 *
 * No payloads in logs (CLAUDE.md golden rule: payslips = PII) — nothing in
 * this file or its implementations logs artifact bytes; only refs/hashes
 * would ever be appropriate to log, and this port doesn't log at all.
 */

/** RFC 3339 timestamp, e.g. "2026-08-27T00:00:00Z" or with a numeric offset.
 * Deliberately full-timestamp only (not date-only "2026-08-27") to match
 * this codebase's existing convention for stored instants (registry
 * `createdAt`/`updatedAt`/`occurredAt` are all `new Date().toISOString()`
 * — a `Z`-suffixed RFC 3339 timestamp). */
const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate `retentionUntil` at runtime and return it back (for convenient
 * chaining). Throws a `TypeError` with a clear message for anything that
 * is not a syntactically valid RFC 3339 timestamp — missing, null, empty,
 * wrong type, or unparseable. This is the one function every
 * `ArchiveStore.archive` implementation must call before writing a single
 * byte: "archiving without retention fails" is the DoD, not "archiving
 * without retention warns."
 */
export function assertValidRetentionUntil(value: unknown): string {
  if (value === undefined || value === null) {
    throw new TypeError('retentionUntil is mandatory: got missing/null value.');
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`retentionUntil must be a non-empty RFC 3339 timestamp string, got: ${typeof value}`);
  }
  if (!RFC3339_TIMESTAMP.test(value)) {
    throw new TypeError(
      `retentionUntil must be an RFC 3339 timestamp (e.g. "2026-08-27T00:00:00Z"), got: "${value}"`,
    );
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`retentionUntil is not a parseable date/time: "${value}"`);
  }
  return value;
}

/** Input to `ArchiveStore.archive`. `retentionUntil` is required at the
 * type level — see the module comment for why this is not `?:`. */
export interface ArchiveInput {
  /** The artifact's rendered bytes, exactly as they will be retrieved later. */
  bytes: Uint8Array;
  /** IANA media type, e.g. "application/pdf". */
  mediaType: string;
  /** RFC 3339 timestamp. Mandatory — see `assertValidRetentionUntil`. */
  retentionUntil: string;
}

/**
 * Backend-agnostic archive port. `archive` returns an opaque `archiveRef`
 * string that `retrieve` can later resolve back to the same bytes —
 * opaque to callers (they store it, they don't parse it), but each
 * implementation documents its own ref shape for its own retrieve() to
 * rely on.
 */
export interface ArchiveStore {
  /** Write `input.bytes` durably and return an `archiveRef` that
   * `retrieve` can resolve back to the same bytes. Rejects if
   * `input.retentionUntil` is missing or invalid — never writes bytes
   * first and validates after. */
  archive(input: ArchiveInput): Promise<string>;

  /** Fetch back the bytes previously archived under `archiveRef`. Rejects
   * if `archiveRef` does not resolve to anything this store archived. */
  retrieve(archiveRef: string): Promise<Uint8Array>;

  /**
   * Permanently delete the bytes previously archived under `archiveRef`
   * (used by retention enforcement). Idempotent: purging an
   * `archiveRef` that no longer exists (already purged, or never existed)
   * must NOT reject — a caller retrying a partially-completed purge run
   * must be able to call this again safely. Does not touch any registry
   * row; the caller is responsible for recording that the purge happened.
   */
  purge(archiveRef: string): Promise<void>;

  /**
   * OPTIONAL (used by `OutputPort.reproduce`): the IANA media type
   * recorded when `archiveRef` was archived, or `undefined` when this
   * store did not record one. A store that cannot answer leaves the method
   * unimplemented and `reproduce` OMITS `mediaType` rather than guessing —
   * "application/pdf" is never asserted as if it had been read back.
   * `FsArchiveStore` answers from its `.meta.json` sidecar.
   */
  retrieveMediaType?(archiveRef: string): Promise<string | undefined>;
}
