/**
 * The console (docs/UI-DESIGN.md).
 * Server-rendered HTML screens, no build step, no client framework, no
 * client JS — mounted under `/output` by server.ts:
 *
 *   - GET /output                      — Overview (failures-first home; `/output/` → 301)
 *   - GET /output/settings             — Settings (four flat read-only groups)
 *   - GET /output/documents            — Registry
 *   - GET /output/documents/:docId     — Document detail (rendered inline via
 *                      an A4-styled frame, below)
 *   - GET /output/documents/:docId/reproduce — Reproduce: streams the
 *                      archived bytes through `OutputPort.reproduce`, stamping
 *                      one `reprint_log` row. The ONLY reprint verb with a
 *                      console control — `regenerate`/`reissue` need
 *                      caller-supplied data the console has nowhere to collect
 *                      (HLD §1) and stay ERP-caller-only, permanently.
 *   - GET /output/documents/:docId/preview — a PASSIVE inline view: streams
 *                      the archived bytes through `OutputPort.peekArchive`
 *                      (same document-level authorization as reproduce, no
 *                      `reprint_log` stamp). Document detail's `<embed>`
 *                      loads this route; it is not a reprint action and has
 *                      no control of its own.
 *   - GET /output/trace/:id            — Rule trace
 *   - GET /output/operations           — Operations (delivery queue)
 *   - GET /output/templates            — Templates list (variants + log-truth lifecycle)
 *   - GET|POST /output/templates/:templateId/:version/review — Review-and-approve
 *
 * The console is read-only on the DOCUMENT registry (ADR-007 addendum).
 * The single write is `POST .../review`, which appends ONE row to the
 * append-only `template_lifecycle_log` through `TemplateLifecycleService.
 * transition` — every refusal code comes from lifecycle/transitions.ts,
 * never re-implemented here. The document-type registry is reached
 * through the narrow read-only `TemplateSource` below: the console cannot
 * register, mutate, or generate anything.
 *
 * Actor identity on the review screen is PROXY-ASSERTED lifecycle-audit
 * identity only (`X-Actor-Subject` / `X-Actor-Role`, or an injectable
 * `resolveActor` — see server.ts). It is never authenticated here, never
 * passed to `AuthorizationPort`, and never used for owner/PII scoping. No
 * fallback identity: no subject means no transition (400 `actor-required`).
 *
 * Design brief this implements verbatim (binding, from a console-designer
 * review — not re-derived here): plain typographic weight only, no
 * status-chip/color-badge systems, no summary counters/tiles, no
 * sortable columns or filter dropdowns beside the one search box, no
 * editable fields, depth <= 2 (Registry -> Document detail (-> Rule trace)
 * — the Rule trace screen never links anywhere else), and one primary
 * action per screen (none, live, for any of these three — see
 * docs/UI-DESIGN.md's five principles).
 *
 * inputHash/outputHash/rendererVersion are rendered "—" wherever null.
 * All three are written together by `archiveArtifact` at archive time
 * (inputHash: SHA-256 of the raw payload as received; outputHash: SHA-256
 * of the archived bytes as stored, a tamper-evidence check, not a
 * reproducibility check; rendererVersion: `rendererId@version`), so all
 * three are null only for DRAFT rows and rows archived before these
 * columns were persisted. The console must be honest about those nulls,
 * never fabricate or hide them.
 */
import type { ServerResponse } from 'node:http';
import type { DocNode, TemplateLifecycle, TemplateMeta, VariantKey } from '@busy-office/output-schema';
import type { DocumentRegistryRow, OutboxEntry, RegistryStore, TemplateLifecycleEvent } from './registry/registry-store.js';
import type { DeterminationTrace, ResolutionTrace, RuleTraceEntry, TemplateTraceEntry } from './determination/trace.js';
import type { BackoffPolicy, DeliveryJob, DeliveryJobStatus, DeliveryQueue } from './delivery/delivery-queue.js';
import type { Actor, OwnerScopeSource } from './authorization/authorization-port.js';
import type { OutputRule } from './determination/rule-types.js';
import { CHANNELS_REQUIRING_MESSAGE, type MessageTemplate, type MessageTemplateMeta } from './message/message-template.js';
import type { TemplateLifecycleKey, TemplateLifecycleService } from './lifecycle/template-lifecycle.js';
import { standingApproval, type TransitionRefusal } from './lifecycle/transitions.js';
import { formatDiffRow, structuralDiff, type DiffRow } from './lifecycle/structural-diff.js';
import { actorRequiredProblem, crossSiteRequestProblem, notFoundProblem, unknownReviewActionProblem } from './problem.js';
import { sendHtml, sendProblem, sendText } from './http-helpers.js';
import type { PeekInput, PeekResult, ReproduceInput, ReproduceResult } from './embed/create-output.js';

/**
 * The read-only slice of `DocumentTypeRegistry` the console sees:
 * satisfied by the real registry, but with no
 * `register` — the console cannot add or mutate a document type. Includes
 * `ownerIdPath` so it subsumes `OwnerScopeSource` (the Registry lock).
 */
export interface TemplateSource extends OwnerScopeSource {
  templateMetas(): readonly TemplateMeta[];
  templateMeta(templateId: string): TemplateMeta | undefined;
  templateContent(templateId: string): DocNode | undefined;
  messageTemplateMetas(): readonly MessageTemplateMeta[];
  messageTemplate(id: string): MessageTemplate | undefined;
  rules(): readonly OutputRule[];
}

/** The four form verbs the review screen accepts, mapped to the lifecycle
 * TARGET state — the transition table (transitions.ts) decides whether
 * the edge exists from the current state; this map only names the target. */
const REVIEW_ACTIONS: Readonly<Record<string, TemplateLifecycle>> = {
  approve: 'approved',
  publish: 'published',
  return: 'draft',
  reopen: 'draft',
};

const REVIEW_PATH = /^\/output\/templates\/([^/]+)\/([^/]+)\/review$/;

/** The review route's key, or `undefined` when `path` is not that route. */
export function parseReviewPath(path: string): TemplateLifecycleKey | undefined {
  const match = REVIEW_PATH.exec(path);
  if (match === null) return undefined;
  try {
    return { templateId: decodeURIComponent(match[1]), version: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
}

/** Registry screen's page size — also what a "load more" link advances by. */
const DOCUMENTS_PAGE_SIZE = 50;

/** Operations screen's page size — same convention as the Registry screen. */
const OPERATIONS_PAGE_SIZE = 50;

/** Statuses shown with no `q` — delivered is terminal success (noise),
 * "quiet when green" (docs/UI-DESIGN.md principle 2). */
const OPERATIONS_DEFAULT_STATUSES: DeliveryJobStatus[] = ['pending', 'in_progress', 'poison'];

/**
 * How old a pending `composition_outbox` row, or an `in_progress` delivery
 * job's `updatedAt`, must be before the Overview calls it stranded/stuck.
 * ONE constant, two consumers (Overview groups "Not archived" (a) and
 * "Stuck deliveries") — a composition or a delivery attempt younger than
 * this is presumed in flight, not failed.
 */
export const STRANDED_AFTER_MS = 5 * 60_000;

/** Overview rows per failure group before the group defers to its owning
 * screen with one link. */
const OVERVIEW_GROUP_CAP = 50;

/**
 * What the Settings screen states — a CLOSED shape of
 * booleans, numbers, names, and the three configured paths, BUILT by the
 * composition root (index.ts `buildConsoleFacts`) and handed to the server
 * as one optional `IngressServerOptions.consoleFacts`. No index signature,
 * no env passthrough, no field that could carry a credential: SMTP auth,
 * S3 keys, and every env var other than the three path vars stop at
 * index.ts and enter here only as a `…Configured` boolean. The
 * `assertNoCredentialShapedKey` check below is the type-level lock.
 */
export interface ConsoleFacts {
  channels: {
    sender:
      | { kind: 'filesystem'; outboxDir: string }
      | { kind: 'email'; host: string; port: number; tls: boolean; authConfigured: boolean }
      | { kind: 'object-store'; bucket: string; prefix: string; endpoint: string | undefined; credentialsConfigured: boolean };
    retry: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
    workerIntervalMs: number;
  };
  retention: {
    /** One row per registered document type, registration order. */
    documentTypes: ReadonlyArray<{ documentType: string; years: number; isDefault: boolean }>;
    defaultYears: number;
    archive:
      | { kind: 'filesystem'; archiveDir: string }
      | { kind: 's3'; bucket: string; endpoint: string | undefined; credentialsConfigured: boolean };
    registry: { kind: 'sqlite'; dbPath: string };
  };
  /** One row per registered renderer, exactly one `isDefault`. */
  renderers: ReadonlyArray<{ id: string; version: string; isDefault: boolean }>;
  access: {
    /** Document types whose registration supplies an `ownerIdPath`. */
    ownerScopedDocumentTypes: readonly string[];
  };
}

type CredentialShaped<K extends string> = Lowercase<K> extends `${string}${'pass' | 'secret' | 'token' | 'key'}${string}` ? K : never;
/** Every key, at any depth of `T`, whose name looks like a credential. */
type CredentialShapedKeys<T> = T extends readonly (infer U)[]
  ? CredentialShapedKeys<U>
  : T extends object
    ? { [K in keyof T & string]: CredentialShaped<K> | CredentialShapedKeys<T[K]> }[keyof T & string]
    : never;
/** Compile-time lock: `ConsoleFacts` has no key matching /pass|secret|token|key/i at any depth. */
const assertNoCredentialShapedKey: [CredentialShapedKeys<ConsoleFacts>] extends [never] ? true : never = true;
void assertNoCredentialShapedKey;

/** The five section roots the nav links to (depth 0 in docs/UI-DESIGN.md's
 * "depth ≤ 2"). Exported for the console tests' depth crawl. */
export const CONSOLE_SECTION_PATHS = ['/output', '/output/documents', '/output/templates', '/output/operations', '/output/settings'] as const;

export function isConsolePath(path: string): boolean {
  return (
    path === '/output' ||
    path === '/output/' ||
    path === '/output/settings' ||
    path === '/output/documents' ||
    // Covers both the document detail route and
    // `/output/documents/:docId/reproduce` — server.ts dispatches the
    // latter to `handleReproduceRequest` before it ever reaches
    // `handleConsoleRequest`'s document-detail branch.
    path.startsWith('/output/documents/') ||
    path.startsWith('/output/trace/') ||
    path === '/output/operations' ||
    path === '/output/templates' ||
    path.startsWith('/output/templates/')
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sanitize an arbitrary ruleId/templateId into a safe HTML id-attribute fragment. */
function toAnchorId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-');
}

function orDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : escapeHtml(value);
}

const PAGE_STYLE = `
  body { font-family: ui-monospace, "SF Mono", Consolas, monospace; max-width: 72rem; margin: 2rem auto; padding: 0 1rem; color: #111; background: #fff; line-height: 1.5; }
  h1 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; }
  nav.console { font-size: 0.85rem; margin-bottom: 1.5rem; }
  a { color: #111; text-decoration: underline; }
  form.search { margin-bottom: 1.5rem; }
  form.search input[type="text"] { font-family: inherit; font-size: 0.9rem; padding: 0.3rem 0.5rem; width: 24rem; max-width: 100%; }
  form.search button { font-family: inherit; font-size: 0.9rem; padding: 0.3rem 0.7rem; }
  ul.rows { list-style: none; margin: 0; padding: 0; }
  li.row { border: 1px solid #ccc; padding: 0.6rem 0.8rem; margin-bottom: 0.5rem; }
  li.row > div { font-size: 0.85rem; }
  dl.facts { display: grid; grid-template-columns: 12rem 1fr; row-gap: 0.35rem; column-gap: 1rem; margin: 0 0 1.5rem; }
  dl.facts dt { font-weight: 600; }
  dl.facts dd { margin: 0; word-break: break-all; }
  section { margin-bottom: 1.5rem; }
  section > h2 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.5rem; }
  ul.plain { list-style: none; margin: 0; padding: 0; }
  ul.plain li { border: 1px solid #ccc; padding: 0.5rem 0.7rem; margin-bottom: 0.4rem; font-size: 0.85rem; }
  .trichotomy-row { padding: 0.3rem 0; font-size: 0.9rem; }
  .trace-header { font-size: 0.9rem; margin-bottom: 1rem; }
  .rule-row, .template-row { border: 1px solid #ccc; padding: 0.5rem 0.7rem; margin-bottom: 0.4rem; font-size: 0.85rem; }
  .rule-row ul, .template-row ul { margin: 0.3rem 0 0 1.2rem; padding: 0; }
  .resolution-block { border: 1px solid #888; padding: 0.6rem 0.8rem; margin-bottom: 0.8rem; }
  .resolution-block h3 { font-size: 0.9rem; margin: 0 0 0.4rem; font-weight: 600; }
  form.review textarea { font-family: inherit; font-size: 0.9rem; padding: 0.3rem 0.5rem; width: 36rem; max-width: 100%; display: block; }
  .primary { font-weight: 600; }
  .refusal { border: 1px solid #888; padding: 0.4rem 0.7rem; margin: 0.4rem 0; font-size: 0.85rem; }
`;

/** The one nav line, byte-identical on every console page: the five
 * sections, no active class, no counts, no icons (no Rules page — it is
 * not built). */
const CONSOLE_NAV =
  '<nav class="console"><a href="/output">Overview</a> · <a href="/output/documents">Documents</a> · <a href="/output/templates">Templates</a> · <a href="/output/operations">Operations</a> · <a href="/output/settings">Settings</a></nav>';

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${CONSOLE_NAV}
${bodyHtml}
</body>
</html>`;
}

/** The poison cross-link (docs/UI-DESIGN.md: "registry poison -> operations"),
 * shared by the Registry row and the Document detail's delivery-history
 * section — both check the same condition off `deliveryHistory`, no new
 * `DeliveryQueue` import needed at either call site. */
function operationsCrossLink(docId: string): string {
  return `<a href="/output/operations?q=${encodeURIComponent(docId)}">View in Operations queue</a>`;
}

function lastDeliveryLine(row: DocumentRegistryRow): string {
  if (row.deliveryHistory.length === 0) return '';
  const last = row.deliveryHistory[row.deliveryHistory.length - 1];
  const crossLink = last.status === 'poisoned' ? ` ${operationsCrossLink(row.docId)}` : '';
  return `<div>${escapeHtml(last.status)} ${escapeHtml(last.occurredAt)}${crossLink}</div>`;
}

function renderDocumentsPage(registryStore: RegistryStore, query: URLSearchParams, documentTypes: OwnerScopeSource | undefined): string {
  const search = query.get('q') ?? '';
  const offset = Number.parseInt(query.get('offset') ?? '0', 10) || 0;
  // Fetch one extra row to know whether a "load more" link is warranted,
  // without a separate COUNT(*) query (docs/UI-DESIGN.md: no pagination
  // widget beyond an optional simple "load more" link).
  const fetched = registryStore.listDocuments({ search, limit: DOCUMENTS_PAGE_SIZE + 1, offset });
  const hasMore = fetched.length > DOCUMENTS_PAGE_SIZE;
  const rows = hasMore ? fetched.slice(0, DOCUMENTS_PAGE_SIZE) : fetched;

  const rowsHtml = rows
    .map((row) => {
      // Owner-scoped rows (the registered type supplies an `ownerIdPath` —
      // the built-in payslip does) carry the lock glyph. No
      // registry threaded in (bare server) -> no type is owner-scoped.
      const lock = documentTypes?.ownerIdPath(row.documentType) !== undefined ? ' 🔒' : '';
      return `<li class="row">
  <div><a href="/output/documents/${encodeURIComponent(row.docId)}">${escapeHtml(row.docId)}</a>${lock}</div>
  <div>${escapeHtml(row.state)}</div>
  <div>${escapeHtml(row.templateVersion)} · ${orDash(row.rendererVersion)}</div>
  ${lastDeliveryLine(row)}
</li>`;
    })
    .join('\n');

  const searchParam = search === '' ? '' : `&q=${encodeURIComponent(search)}`;
  const loadMore = hasMore
    ? `<p><a href="/output/documents?offset=${offset + DOCUMENTS_PAGE_SIZE}${searchParam}">Load more</a></p>`
    : '';

  return renderPage(
    'Registry',
    `<h1>Registry</h1>
<form class="search" method="GET" action="/output/documents">
  <input type="text" name="q" value="${escapeHtml(search)}" placeholder="docId / businessObjectId / event / templateVersion">
  <button type="submit">Search</button>
</form>
<ul class="rows">
${rowsHtml}
</ul>
${loadMore}`,
  );
}

/** The reproduce reason is a fixed constant text — the operator is not
 * prompted (the ruling named only "reproduce gains a console control", no
 * form; a tiny GET form to let the operator type a reason is a plausible
 * future extension, flagged rather than decided here). */
const REPRODUCE_REASON = 'console reproduce';

function reproduceHref(docId: string): string {
  return `/output/documents/${encodeURIComponent(docId)}/reproduce?reason=${encodeURIComponent(REPRODUCE_REASON)}`;
}

/** The A4-styled preview frame (CSS-only, no client JS): an `<embed>` of
 * the passive preview route when there are bytes to show, otherwise a
 * plain-text placeholder inside the same frame — never an `<embed src>`
 * pointing at a route statically known to have nothing to serve. */
function renderPreviewFrame(row: DocumentRegistryRow): string {
  const inner =
    row.archiveRef !== null
      ? `<embed type="application/pdf" src="/output/documents/${encodeURIComponent(row.docId)}/preview" style="width: 100%; height: 100%;">`
      : row.purgedAt !== null
        ? `<p style="padding: 1rem; font-size: 0.85rem;">archived bytes purged (retention expired) on ${escapeHtml(row.purgedAt)}</p>`
        : `<p style="padding: 1rem; font-size: 0.85rem;">not archived yet — nothing to preview</p>`;
  return `<div class="a4-frame" style="aspect-ratio: 1 / 1.4142; max-width: 52rem; margin: 0 auto 1.5rem; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
  ${inner}
</div>`;
}

function renderDocumentDetailPage(row: DocumentRegistryRow, hasTrace: boolean): string {
  const hasPoisonedDelivery = row.deliveryHistory.some((e) => e.status === 'poisoned');
  const deliveryHtml =
    row.deliveryHistory.length === 0
      ? '<p>No delivery history.</p>'
      : `<ul class="plain">
${row.deliveryHistory
  .map(
    (e) =>
      `<li>${escapeHtml(e.channel)} · ${escapeHtml(e.status)} · ${escapeHtml(e.occurredAt)}${e.detail !== undefined ? ' · ' + escapeHtml(e.detail) : ''}</li>`,
  )
  .join('\n')}
</ul>${hasPoisonedDelivery ? `<p>${operationsCrossLink(row.docId)}</p>` : ''}`;

  const traceLink = hasTrace
    ? `<p><a href="/output/trace/${encodeURIComponent(row.docId)}">Rule trace</a></p>`
    : '';

  return renderPage(
    `Document ${row.docId}`,
    `<h1>Document detail</h1>
${renderPreviewFrame(row)}
<dl class="facts">
  <dt>docId</dt><dd>${escapeHtml(row.docId)}</dd>
  <dt>state</dt><dd>${escapeHtml(row.state)}</dd>
  <dt>businessObject</dt><dd>${escapeHtml(row.businessObject)}</dd>
  <dt>businessObjectId</dt><dd>${escapeHtml(row.businessObjectId)}</dd>
  <dt>event</dt><dd>${escapeHtml(row.event)}</dd>
  <dt>templateVersion · rendererVersion</dt><dd>${escapeHtml(row.templateVersion)} · ${orDash(row.rendererVersion)}</dd>
  <dt>inputHash</dt><dd>${orDash(row.inputHash)}</dd>
  <dt>outputHash</dt><dd>${orDash(row.outputHash)}</dd>
  <dt>archiveRef</dt><dd>${orDash(row.archiveRef)}</dd>
  <dt>retentionUntil</dt><dd>${row.retentionUntil === null ? 'not yet archived' : escapeHtml(row.retentionUntil)}</dd>
  <dt>PDF/A</dt><dd>PDF/A-2b · veraPDF-verified in CI</dd>
</dl>
<section>
  <h2>Delivery history</h2>
  ${deliveryHtml}
</section>
<section>
  <h2>Reprint</h2>
  <div class="trichotomy-row"><a href="${reproduceHref(row.docId)}">Reproduce</a> (archive bytes, stamped)</div>
  <div class="trichotomy-row">Regenerate (current template+data, new doc) — ERP-caller-only verb (API); the registry holds no payload for an operator to supply</div>
  <div class="trichotomy-row">Reissue (new event) — ERP-caller-only verb (API); the registry holds no payload for an operator to supply</div>
</section>
${traceLink}`,
  );
}

function renderRuleRow(entry: RuleTraceEntry): string {
  return `<div class="rule-row" id="rule-${toAnchorId(entry.ruleId)}">
  <div>${escapeHtml(entry.ruleId)} / ${entry.matched ? 'matched' : 'not matched'} / specificity ${entry.specificity} / priority ${entry.priority}</div>
  <ul>
${entry.reasons.map((r) => `    <li>${escapeHtml(r)}</li>`).join('\n')}
  </ul>
</div>`;
}

function renderTemplateRow(entry: TemplateTraceEntry): string {
  return `<div class="template-row">
  <div>${escapeHtml(entry.templateId)} / ${entry.matched ? 'matched' : 'not matched'} / specificity ${entry.specificity}</div>
  <ul>
${entry.reasons.map((r) => `    <li>${escapeHtml(r)}</li>`).join('\n')}
  </ul>
</div>`;
}

function renderResolutionBlock(resolution: ResolutionTrace): string {
  const variantFields = Object.entries(resolution.variantQuery)
    .map(([k, v]) => `${k}=${escapeHtml(String(v))}`)
    .join(' · ');
  const winning =
    resolution.winningTemplateId !== undefined
      ? `<div><strong>winningTemplateId:</strong> ${escapeHtml(resolution.winningTemplateId)}</div>`
      : '';
  return `<div class="resolution-block">
  <h3><a href="#rule-${toAnchorId(resolution.ruleId)}">${escapeHtml(resolution.ruleId)}</a></h3>
  <div>${variantFields}</div>
  ${winning}
${resolution.templates.map(renderTemplateRow).join('\n')}
</div>`;
}

function renderTracePage(id: string, trace: DeterminationTrace): string {
  return renderPage(
    `Trace ${id}`,
    `<h1>Rule trace</h1>
<div class="trace-header">${escapeHtml(trace.documentType)} · ${escapeHtml(trace.businessObject)} · ${escapeHtml(trace.event)} · ${escapeHtml(trace.outcome)}</div>
<section>
  <h2>Rules</h2>
${trace.rules.map(renderRuleRow).join('\n')}
</section>
<section>
  <h2>Resolutions</h2>
${trace.resolutions.map(renderResolutionBlock).join('\n')}
</section>`,
  );
}

function renderOperationsRow(job: DeliveryJob, maxAttempts: number): string {
  const retryLine =
    job.status === 'poison' ? '<div>Retry — not yet available in this console</div>' : '';
  const errorSuffix = job.lastError !== null ? ` — ${escapeHtml(job.lastError)}` : '';
  return `<li class="row">
  <div><a href="/output/documents/${encodeURIComponent(job.docId)}">${escapeHtml(job.docId)}</a> · ${escapeHtml(job.channel)} · ${job.recipients.length} recipient(s)</div>
  <div>${escapeHtml(job.status)}${errorSuffix}</div>
  <div>attempt ${job.attemptCount}/${maxAttempts} · next attempt ${orDash(job.nextAttemptAt)}</div>
  ${retryLine}
</li>`;
}

function renderOperationsPage(
  deliveryQueue: DeliveryQueue,
  backoffPolicy: BackoffPolicy,
  query: URLSearchParams,
): string {
  const search = query.get('q') ?? '';
  const offset = Number.parseInt(query.get('offset') ?? '0', 10) || 0;
  // No `q`: delivered is terminal success (noise) — "quiet when green".
  // `q` present: every status, including delivered — a poison cross-link
  // that hid a later successful delivery would be misleading.
  const statuses = search === '' ? OPERATIONS_DEFAULT_STATUSES : undefined;
  // Fetch one extra row for a "load more" link, same convention as the
  // Registry screen.
  const fetched = deliveryQueue.listJobs({ search, statuses, limit: OPERATIONS_PAGE_SIZE + 1, offset });
  const hasMore = fetched.length > OPERATIONS_PAGE_SIZE;
  const jobs = hasMore ? fetched.slice(0, OPERATIONS_PAGE_SIZE) : fetched;

  const rowsHtml = jobs.map((job) => renderOperationsRow(job, backoffPolicy.maxAttempts)).join('\n');

  const searchParam = search === '' ? '' : `&q=${encodeURIComponent(search)}`;
  const loadMore = hasMore
    ? `<p><a href="/output/operations?offset=${offset + OPERATIONS_PAGE_SIZE}${searchParam}">Load more</a></p>`
    : '';

  return renderPage(
    'Operations',
    `<h1>Operations</h1>
<form class="search" method="GET" action="/output/operations">
  <input type="text" name="q" value="${escapeHtml(search)}" placeholder="docId / channel">
  <button type="submit">Search</button>
</form>
<ul class="rows">
${rowsHtml}
</ul>
${loadMore}`,
  );
}

// ---------------------------------------------------------------------------
// Templates list + Review-and-approve
// ---------------------------------------------------------------------------

const VARIANT_FIELDS = ['companyCode', 'country', 'partnerId', 'locale'] as const;

function variantFieldsText(variant: VariantKey): string {
  const parts = VARIANT_FIELDS.filter((f) => variant[f] !== undefined).map((f) => `${f}=${escapeHtml(String(variant[f]))}`);
  return parts.length === 0 ? '(all variants)' : parts.join(' · ');
}

/** Deep equality over the five `VariantKey` fields, nothing else. */
function sameVariant(a: VariantKey, b: VariantKey): boolean {
  return a.documentType === b.documentType && VARIANT_FIELDS.every((f) => a[f] === b[f]);
}

function reviewHref(key: TemplateLifecycleKey): string {
  return `/output/templates/${encodeURIComponent(key.templateId)}/${encodeURIComponent(key.version)}/review`;
}

/** Lifecycle as the LOG says it is (`lifecycle.current`), never the
 * declared meta — a key with no log row is said so, not guessed. */
function logTruthLifecycle(lifecycle: TemplateLifecycleService, meta: { id: string; version: string; lifecycle: TemplateLifecycle }): string {
  const current = lifecycle.current({ templateId: meta.id, version: meta.version });
  return current === undefined ? `${escapeHtml(meta.lifecycle)} (declared — no lifecycle record)` : escapeHtml(current);
}

/** A meta of either kind, with the facts the two screens print. */
interface GovernedTemplate {
  kind: 'document' | 'message';
  meta: TemplateMeta | MessageTemplateMeta;
  parentId: string | undefined;
  renderer: string | undefined;
}

function governedTemplates(source: TemplateSource): GovernedTemplate[] {
  return [
    ...source.templateMetas().map((meta): GovernedTemplate => ({ kind: 'document', meta, parentId: meta.parentId, renderer: meta.renderer })),
    ...source.messageTemplateMetas().map((meta): GovernedTemplate => ({ kind: 'message', meta, parentId: undefined, renderer: undefined })),
  ];
}

function findGoverned(source: TemplateSource, key: TemplateLifecycleKey): GovernedTemplate | undefined {
  return governedTemplates(source).find((t) => t.meta.id === key.templateId && t.meta.version === key.version);
}

function renderTemplatesRow(t: GovernedTemplate, depth: number, lifecycle: TemplateLifecycleService): string {
  const key = { templateId: t.meta.id, version: t.meta.version };
  const indent = depth === 0 ? '' : `style="margin-left: ${depth * 1.5}rem"`;
  return `<li class="row" ${indent}>
  <div><a href="${reviewHref(key)}">${escapeHtml(t.meta.id)}@${escapeHtml(t.meta.version)}</a>${t.kind === 'message' ? ' · message' : ''}</div>
  <div>${escapeHtml(t.meta.variant.documentType)} · ${variantFieldsText(t.meta.variant)}</div>
  <div>${logTruthLifecycle(lifecycle, t.meta)}</div>
</li>`;
}

/**
 * Tree order: roots in registration order, each followed by its
 * `parentId` children (indent = inherits). A template whose parent is
 * not registered, or a cycle, is listed at the root — never dropped.
 */
function renderTemplatesPage(source: TemplateSource, lifecycle: TemplateLifecycleService): string {
  const all = governedTemplates(source);
  const ids = new Set(all.map((t) => t.meta.id));
  const rows: string[] = [];
  const seen = new Set<string>();
  const walk = (t: GovernedTemplate, depth: number): void => {
    if (seen.has(t.meta.id)) return;
    seen.add(t.meta.id);
    rows.push(renderTemplatesRow(t, depth, lifecycle));
    for (const child of all) if (child.parentId === t.meta.id) walk(child, depth + 1);
  };
  for (const t of all) if (t.parentId === undefined || !ids.has(t.parentId)) walk(t, 0);
  for (const t of all) walk(t, 0); // anything left (cycles) at the root
  return renderPage(
    'Templates',
    `<h1>Templates</h1>
<ul class="rows">
${rows.join('\n')}
</ul>`,
  );
}

/** What the review screen compares for one key: the registered content
 * (a `DocNode` tree, or a message template's `{ subject, body }`), or
 * `undefined` for a meta-only registration. */
function comparableContent(source: TemplateSource, t: GovernedTemplate): unknown {
  if (t.kind === 'message') {
    const template = source.messageTemplate(t.meta.id);
    return template === undefined ? undefined : { subject: template.subject, body: template.body };
  }
  return source.templateContent(t.meta.id);
}

function metaSlice(t: GovernedTemplate): Record<string, unknown> {
  return { renderer: t.renderer, parentId: t.parentId, provenance: t.meta.provenance };
}

function renderDiffRows(rows: DiffRow[]): string {
  return `<ul class="plain">
${rows.map((r) => `<li>${escapeHtml(formatDiffRow(r))}</li>`).join('\n')}
</ul>`;
}

/**
 * The compare section. Baseline = every registered template of the same
 * kind with a deep-equal `VariantKey`, whose LOG lifecycle is `published`,
 * and whose key differs (visibility rule: the live version stays live
 * after this one publishes, until it is retired). Content diff + meta diff
 * per baseline; the prose cases (none / meta-only / identical) are stated
 * in words, never as an empty list.
 */
function renderCompareSection(source: TemplateSource, lifecycle: TemplateLifecycleService, subject: GovernedTemplate): string {
  const baselines = governedTemplates(source).filter(
    (t) =>
      t.kind === subject.kind &&
      !(t.meta.id === subject.meta.id && t.meta.version === subject.meta.version) &&
      sameVariant(t.meta.variant, subject.meta.variant) &&
      lifecycle.current({ templateId: t.meta.id, version: t.meta.version }) === 'published',
  );
  if (baselines.length === 0) {
    return '<section><h2>Compare</h2><p>no published version of this variant — first publication</p></section>';
  }
  const proposedContent = comparableContent(source, subject);
  const blocks = baselines.map((baseline) => {
    const label = `live now: ${escapeHtml(baseline.meta.id)}@${escapeHtml(baseline.meta.version)} — stays live after publish until retired`;
    let contentHtml: string;
    if (proposedContent === undefined) {
      contentHtml = '<p>meta-only — no content registered</p>';
    } else {
      const baseContent = comparableContent(source, baseline);
      if (baseContent === undefined) {
        contentHtml = '<p>baseline is meta-only — no content registered to compare against</p>';
      } else {
        const rows = structuralDiff(baseContent, proposedContent);
        contentHtml = rows.length === 0 ? '<p>no structural change</p>' : renderDiffRows(rows);
      }
    }
    const metaRows = structuralDiff(metaSlice(baseline), metaSlice(subject), '/meta');
    const metaHtml = metaRows.length === 0 ? '<p>no meta change</p>' : renderDiffRows(metaRows);
    return `<div class="resolution-block">
  <h3>${label}</h3>
  ${contentHtml}
  ${metaHtml}
</div>`;
  });
  return `<section><h2>Compare</h2>
${blocks.join('\n')}
</section>`;
}

/**
 * Blast radius: how many registered rules CAN resolve onto this variant —
 * same documentType, and no rule-fixed field (resolution override, else
 * condition) that contradicts a field the variant constrains. A field the
 * rule leaves open may be supplied by the event, so it counts. Message
 * templates additionally need a channel that carries a message.
 */
function blastRadius(rules: readonly OutputRule[], subject: GovernedTemplate): number {
  const variant = subject.meta.variant;
  return rules.filter((rule) => {
    if (rule.conditions.documentType !== variant.documentType) return false;
    if (subject.kind === 'message' && !CHANNELS_REQUIRING_MESSAGE.has(rule.resolution.channel)) return false;
    for (const field of VARIANT_FIELDS) {
      const want = variant[field];
      if (want === undefined) continue;
      const fixed = rule.resolution[field] ?? (field === 'locale' ? undefined : rule.conditions[field]);
      if (fixed !== undefined && fixed !== want) return false;
    }
    return true;
  }).length;
}

function actorText(actor: Actor | undefined): string {
  return actor?.subjectId !== undefined && actor.subjectId.trim() !== ''
    ? `acting as ${escapeHtml(actor.subjectId)} (${escapeHtml(actor.role)})`
    : 'no actor identity on this request';
}

function refusalHtml(code: TransitionRefusal | undefined): string {
  if (code === undefined) return '';
  return `<p class="refusal" role="alert" data-refusal="${escapeHtml(code)}">refused: ${escapeHtml(code)}</p>`;
}

/** Exactly one primary per phase, none outside review/approved; the
 * secondary is the plain "send back" verb. `submit` and `retire` are
 * deliberately not controls here (MUST NOT BUILD). */
function phaseControls(state: TemplateLifecycle | undefined, refusal: TransitionRefusal | undefined): string {
  const underPrimary = refusal !== undefined && refusal !== 'reason-required' ? refusalHtml(refusal) : '';
  switch (state) {
    case 'review':
      return `<div><button type="submit" class="primary" name="action" value="approve">Approve</button>
  <button type="submit" name="action" value="return">Send back to draft</button></div>${underPrimary}`;
    case 'approved':
      return `<div><button type="submit" class="primary" name="action" value="publish">Publish</button>
  <button type="submit" name="action" value="reopen">Send back to draft</button></div>${underPrimary}`;
    case 'draft':
      return `<p>draft — submit for review happens where drafts are made</p>${underPrimary}`;
    case 'published':
      return `<p>published — live</p>${underPrimary}`;
    case 'retired':
      return `<p>retired — terminal</p>${underPrimary}`;
    case undefined:
      return `<p>no lifecycle record for this key</p>${underPrimary}`;
  }
}

function historyRow(e: TemplateLifecycleEvent): string {
  return `<li>${escapeHtml(e.fromState ?? 'seed')} → ${escapeHtml(e.toState)} · ${escapeHtml(e.actorSubjectId)} (${escapeHtml(e.actorRole)}) · ${escapeHtml(e.reason)} · ${escapeHtml(e.occurredAt)}</li>`;
}

interface ReviewRender {
  actor: Actor | undefined;
  /** The refusal to show, if this render answers a refused POST. */
  refusal?: TransitionRefusal;
  /** The typed reason to preserve across a refused POST. */
  reason?: string;
}

function renderReviewPage(source: TemplateSource, lifecycle: TemplateLifecycleService, subject: GovernedTemplate, opts: ReviewRender): string {
  const key = { templateId: subject.meta.id, version: subject.meta.version };
  const state = lifecycle.current(key);
  const history = lifecycle.history(key);
  const approval = standingApproval(history);
  const seed = history.find((e) => e.fromState === null);
  const approvalText =
    approval !== undefined
      ? `${escapeHtml(approval.actorSubjectId)} (${escapeHtml(approval.actorRole)}) · ${escapeHtml(approval.reason)} · ${escapeHtml(approval.occurredAt)}`
      : `none${seed !== undefined ? ` (seeded by ${escapeHtml(seed.actorSubjectId)})` : ''}`;
  const reasonRefusal = opts.refusal === 'reason-required' ? refusalHtml(opts.refusal) : '';
  const historyHtml = history.length === 0 ? '<p>No lifecycle history.</p>' : `<ul class="plain">\n${history.map(historyRow).join('\n')}\n</ul>`;

  return renderPage(
    `Review ${subject.meta.id}@${subject.meta.version}`,
    `<h1>Review-and-approve</h1>
<div class="trace-header">${escapeHtml(subject.meta.id)}@${escapeHtml(subject.meta.version)} · ${escapeHtml(subject.meta.variant.documentType)} · ${variantFieldsText(subject.meta.variant)} · ${subject.kind === 'message' ? 'message' : orDash(subject.renderer)} · ${orDash(subject.meta.provenance)}</div>
<div class="trace-header">${state === undefined ? 'no lifecycle record' : escapeHtml(state)} · approval record: ${approvalText}</div>
<div class="trace-header">${actorText(opts.actor)}</div>
${renderCompareSection(source, lifecycle, subject)}
<section><h2>Blast radius</h2><p>${blastRadius(source.rules(), subject)} registered rule(s) can resolve onto this variant</p></section>
<section>
  <h2>Decision</h2>
  <form class="review" method="POST" action="${reviewHref(key)}">
    <label>reason (recorded in the audit log)
      <textarea name="reason" required rows="3">${escapeHtml(opts.reason ?? '')}</textarea>
    </label>
    ${reasonRefusal}
    ${phaseControls(state, opts.refusal)}
  </form>
</section>
<section>
  <h2>Lifecycle history</h2>
  ${historyHtml}
</section>
<p><a href="/output/templates">Templates</a></p>`,
  );
}

/** What the review POST needs beyond the response: the read-only template
 * source, the lifecycle service (its only writer here), and the actor the
 * transport resolved — `undefined` when none was asserted. */
export interface ReviewPostRequest {
  path: string;
  form: URLSearchParams;
  actor: Actor | undefined;
  /** The request's `Sec-Fetch-Site` header, if any. */
  secFetchSite: string | undefined;
}

/**
 * `POST /output/templates/:templateId/:version/review`. Order of checks:
 * cross-site (403) → route/key known (404) → actor asserted (400) → action
 * known (400) → `lifecycle.transition` (refusal → 422 re-render with the
 * message under the owning control; success → 303 to the list). Nothing
 * is appended on any non-303 path — the service appends nothing on a
 * refusal, and every earlier check returns before calling it. Nothing
 * from the form (reason, subject) is logged.
 */
export function handleReviewPost(
  res: ServerResponse,
  request: ReviewPostRequest,
  source: TemplateSource | undefined,
  lifecycle: TemplateLifecycleService,
): void {
  if (request.secFetchSite !== undefined && request.secFetchSite !== 'same-origin' && request.secFetchSite !== 'none') {
    sendProblem(res, crossSiteRequestProblem());
    return;
  }
  const key = parseReviewPath(request.path);
  const subject = key !== undefined && source !== undefined ? findGoverned(source, key) : undefined;
  if (key === undefined || source === undefined || subject === undefined || lifecycle.current(key) === undefined) {
    sendProblem(res, notFoundProblem(request.path));
    return;
  }
  const actor = request.actor;
  if (actor === undefined || typeof actor.subjectId !== 'string' || actor.subjectId.trim() === '') {
    sendProblem(res, actorRequiredProblem());
    return;
  }
  const action = request.form.get('action') ?? '';
  const target = Object.prototype.hasOwnProperty.call(REVIEW_ACTIONS, action) ? REVIEW_ACTIONS[action] : undefined;
  if (target === undefined) {
    sendProblem(res, unknownReviewActionProblem());
    return;
  }
  const reason = request.form.get('reason') ?? '';
  const result = lifecycle.transition(key, target, actor, reason);
  if (result.status === 'refused') {
    if (result.refused === 'unknown-template') {
      sendProblem(res, notFoundProblem(request.path));
      return;
    }
    sendHtml(res, 422, renderReviewPage(source, lifecycle, subject, { actor, refusal: result.refused, reason }));
    return;
  }
  res.writeHead(303, { Location: '/output/templates', 'Content-Length': 0 });
  res.end();
}

// ---------------------------------------------------------------------------
// Reproduce: GET /output/documents/:docId/reproduce
// ---------------------------------------------------------------------------

const REPRODUCE_PATH = /^\/output\/documents\/([^/]+)\/reproduce$/;

/** The reproduce route's docId, or `undefined` when `path` is not that route. */
export function parseReproducePath(path: string): string | undefined {
  const match = REPRODUCE_PATH.exec(path);
  if (match === null) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** Known archived media types this console can name a download extension
 * for. Anything else (or no media type at all — `ArchiveStore` may not
 * answer `retrieveMediaType`) falls back to `.bin`: an honest "we don't
 * know" rather than a guessed/wrong extension. */
const MEDIA_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
};

function downloadFilename(docId: string, mediaType: string | undefined): string {
  const ext = (mediaType !== undefined ? MEDIA_TYPE_EXTENSIONS[mediaType] : undefined) ?? 'bin';
  // Reuse the same anchor-id sanitizer as rule/template ids: a docId is
  // never attacker-controlled HTML here (it's a header value, not a body),
  // but a filename with a stray quote/slash is still worth avoiding.
  return `${toAnchorId(docId)}.${ext}`;
}

/** A refusal rendered as a plain HTML page (not problem+json) — the review
 * screen's html-first refusal style (`sendHtml`, never a raw JSON blob),
 * because this route is a browser download link, not an API caller. Never
 * echoes anything from the archived document itself — only the docId (from
 * the URL the caller already has) and a fixed, non-PII detail string. */
function reproduceProblemPage(title: string, detail: string): string {
  return renderPage(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`);
}

/** The narrow slice of `OutputPort` this route needs — avoids importing the
 * whole port type just to call one verb. */
export interface ReproducePort {
  reproduce(input: ReproduceInput): Promise<ReproduceResult>;
}

/**
 * `GET /output/documents/:docId/reproduce`. Goes through
 * `port.reproduce` — the SAME actor/authorization/audit path
 * `OutputPort.reproduce` gives every caller (CLAUDE.md: "Authorization is
 * evaluated against the DOCUMENT, not the endpoint"); this handler adds no
 * checks of its own beyond mapping the typed result to HTTP. `actor` is
 * `undefined` only when the transport asserted no `X-Actor-Subject` at
 * all — stood in as a subject-less placeholder so the port's own
 * `admitReprint` order (unknown-document → forbidden → actor-required →
 * reason-required) runs unmodified; a missing `reason` query param is
 * passed through as `''` for the same reason (the port's own
 * `reason-required` refusal fires, never re-implemented here).
 */
export async function handleReproduceRequest(
  res: ServerResponse,
  docId: string,
  reasonParam: string | null,
  port: ReproducePort,
  actor: Actor | undefined,
): Promise<void> {
  const result = await port.reproduce({
    docId,
    actor: actor ?? { role: 'console' },
    reason: reasonParam ?? '',
  });
  switch (result.status) {
    case 'unknown-document':
      sendHtml(res, 404, reproduceProblemPage('Not found', `No document ${docId} in the registry.`));
      return;
    case 'forbidden':
      sendHtml(res, 403, reproduceProblemPage('Forbidden', 'This actor is not authorized to reproduce this document.'));
      return;
    case 'actor-required':
      sendHtml(
        res,
        400,
        reproduceProblemPage('Actor required', 'A lifecycle-audit actor identity (X-Actor-Subject) is required to reproduce a document; none was asserted on this request.'),
      );
      return;
    case 'reason-required':
      sendHtml(res, 400, reproduceProblemPage('Reason required', 'Reproducing an archived document requires a reason (query parameter "reason").'));
      return;
    case 'purged':
      sendHtml(res, 410, reproduceProblemPage('Purged', `This document's archived bytes were purged (retention expired) on ${result.purgedAt}.`));
      return;
    case 'not-archived':
      // 409, not 404: the document exists (its registry row is real) —
      // there are simply no bytes yet to reproduce (DRAFT / stranded).
      // A 404 would say "no such document", which is false.
      sendHtml(res, 409, reproduceProblemPage('Not archived', 'This document has not been archived yet — there are no bytes to reproduce.'));
      return;
    case 'reproduced':
      res.writeHead(200, {
        'Content-Type': result.mediaType ?? 'application/octet-stream',
        'Content-Length': result.bytes.byteLength,
        'Content-Disposition': `attachment; filename="${downloadFilename(docId, result.mediaType)}"`,
      });
      res.end(Buffer.from(result.bytes));
      return;
  }
}

// ---------------------------------------------------------------------------
// Preview: GET /output/documents/:docId/preview — a passive inline view
// ---------------------------------------------------------------------------

const PREVIEW_PATH = /^\/output\/documents\/([^/]+)\/preview$/;

/** The preview route's docId, or `undefined` when `path` is not that route. */
export function parsePreviewPath(path: string): string | undefined {
  const match = PREVIEW_PATH.exec(path);
  if (match === null) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** The narrow slice of `OutputPort` this route needs — mirrors
 * `ReproducePort`, but for the passive verb: no reason, no stamp. */
export interface PreviewPort {
  peekArchive(input: PeekInput): Promise<PeekResult>;
}

/**
 * `GET /output/documents/:docId/preview`. Same document-level
 * authorization `reproduce` gives every caller, via `port.peekArchive` —
 * but this handler never touches `reprint_log`: a browser `<embed>` load
 * (or prefetch) of this route must never silently mint an audit row. A
 * refused/absent outcome is a small `text/plain` body (never HTML, never
 * problem+json) so the A4 frame that loads this route inline can show it
 * as plain text rather than a broken embed.
 */
export async function handlePreviewRequest(
  res: ServerResponse,
  docId: string,
  port: PreviewPort,
  actor: Actor | undefined,
): Promise<void> {
  const result = await port.peekArchive({ docId, actor: actor ?? { role: 'console' } });
  switch (result.status) {
    case 'unknown-document':
      sendText(res, 404, `No document ${docId} in the registry.`);
      return;
    case 'forbidden':
      sendText(res, 403, 'This actor is not authorized to view this document.');
      return;
    case 'not-archived':
      sendText(res, 409, 'This document has not been archived yet — there is nothing to preview.');
      return;
    case 'purged':
      sendText(res, 410, `This document's archived bytes were purged (retention expired) on ${result.purgedAt}.`);
      return;
    case 'available':
      res.writeHead(200, {
        'Content-Type': result.mediaType ?? 'application/octet-stream',
        'Content-Length': result.bytes.byteLength,
        'Content-Disposition': 'inline',
      });
      res.end(Buffer.from(result.bytes));
      return;
  }
}

// ---------------------------------------------------------------------------
// Overview (failures-first home) + Settings
// ---------------------------------------------------------------------------

/** Everything the Overview reads. Only `registryStore` is mandatory: a
 * bare server has no queue (groups 1 and 3 absent) and no registry/
 * lifecycle (group 4 absent). */
export interface OverviewSources {
  registryStore: RegistryStore;
  deliveryQueue?: DeliveryQueue;
  backoffPolicy?: BackoffPolicy;
  documentTypes?: TemplateSource;
  lifecycle?: TemplateLifecycleService;
}

/** One failure group: a heading, its rows (each ONE link), and where the
 * rest live when the cap is hit. Rendered only when `rows` is non-empty. */
interface OverviewGroup {
  heading: string;
  rows: string[];
  /** Owning screen, linked once when the group overflowed the cap. */
  owner: { href: string; label: string };
  overflowed: boolean;
}

function olderThan(iso: string, now: Date, ms: number): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && now.getTime() - t >= ms;
}

function capRows<T>(items: T[]): { kept: T[]; overflowed: boolean } {
  return { kept: items.slice(0, OVERVIEW_GROUP_CAP), overflowed: items.length > OVERVIEW_GROUP_CAP };
}

function operationsRowLink(docId: string): string {
  return `<a href="/output/operations?q=${encodeURIComponent(docId)}">${escapeHtml(docId)}</a>`;
}

/** (1) Poison deliveries — worst. `docId · channel · attempt n/max — lastError`;
 * never recipients, never the message. */
function poisonGroup(queue: DeliveryQueue, policy: BackoffPolicy): OverviewGroup {
  const { kept, overflowed } = capRows(queue.listPoisonJobs());
  const rows = kept.map(
    (job) =>
      `<li class="row">${operationsRowLink(job.docId)} · ${escapeHtml(job.channel)} · attempt ${job.attemptCount}/${policy.maxAttempts}${job.lastError !== null ? ` — ${escapeHtml(job.lastError)}` : ''}</li>`,
  );
  return { heading: 'Poison deliveries', rows, owner: { href: '/output/operations', label: 'Operations' }, overflowed };
}

/** (2) Not archived — (a) outbox rows older than `STRANDED_AFTER_MS`
 * (composition stranded mid-flight) and (b) DRAFT rows with NO outbox row
 * (render failed: submit-resolution.ts clears the outbox, the row stays
 * DRAFT — no threshold, the failure is already final). A docId appears
 * once: a row with an outbox entry is decided by (a) alone, whatever its
 * age. The reason is NOT persisted, so the row says only `not archived`. */
function notArchivedGroup(registryStore: RegistryStore, now: Date): OverviewGroup {
  const outbox = registryStore.listOutboxEntries();
  const inOutbox = new Set(outbox.map((e) => e.docId));
  const stranded: DocumentRegistryRow[] = [];
  for (const entry of outbox.filter((e: OutboxEntry) => olderThan(e.createdAt, now, STRANDED_AFTER_MS))) {
    const row = registryStore.getByDocId(entry.docId);
    if (row !== undefined) stranded.push(row);
  }
  // Fetch enough DRAFT rows that filtering out the in-flight ones can
  // still fill the cap and detect overflow.
  const drafts = registryStore
    .listDocuments({ state: 'DRAFT', limit: OVERVIEW_GROUP_CAP + 1 + inOutbox.size })
    .filter((row) => !inOutbox.has(row.docId));
  const { kept, overflowed } = capRows([...stranded, ...drafts]);
  const rows = kept.map(
    (row) =>
      `<li class="row"><a href="/output/documents/${encodeURIComponent(row.docId)}">${escapeHtml(row.docId)}</a> · ${escapeHtml(row.documentType)} · ${escapeHtml(row.templateVersion)} · created ${escapeHtml(row.createdAt)} · not archived</li>`,
  );
  return { heading: 'Not archived', rows, owner: { href: '/output/documents', label: 'Documents' }, overflowed };
}

/** (3) Stuck deliveries — `in_progress` whose `updatedAt` is older than
 * `STRANDED_AFTER_MS` (an attempt that never came back). */
function stuckGroup(queue: DeliveryQueue, policy: BackoffPolicy, now: Date): OverviewGroup {
  const stuck = queue
    .listJobs({ statuses: ['in_progress'], limit: OVERVIEW_GROUP_CAP * 4, offset: 0 })
    .filter((job) => olderThan(job.updatedAt, now, STRANDED_AFTER_MS));
  const { kept, overflowed } = capRows(stuck);
  const rows = kept.map(
    (job) =>
      `<li class="row">${operationsRowLink(job.docId)} · ${escapeHtml(job.channel)} · attempt ${job.attemptCount}/${policy.maxAttempts} · in progress since ${escapeHtml(job.updatedAt)}</li>`,
  );
  return { heading: 'Stuck deliveries', rows, owner: { href: '/output/operations', label: 'Operations' }, overflowed };
}

/** (4) Awaiting approval — LOG lifecycle `review`; worst-LAST because it
 * is work waiting on a person, not a failure. */
function awaitingApprovalGroup(source: TemplateSource, lifecycle: TemplateLifecycleService): OverviewGroup {
  const inReview = governedTemplates(source).filter(
    (t) => lifecycle.current({ templateId: t.meta.id, version: t.meta.version }) === 'review',
  );
  const { kept, overflowed } = capRows(inReview);
  const rows = kept.map((t) => {
    const key = { templateId: t.meta.id, version: t.meta.version };
    const history = lifecycle.history(key);
    const since = history.length > 0 ? history[history.length - 1].occurredAt : undefined;
    return `<li class="row"><a href="${reviewHref(key)}">${escapeHtml(t.meta.id)}@${escapeHtml(t.meta.version)}</a> · ${escapeHtml(t.meta.variant.documentType)} · in review since ${orDash(since)}</li>`;
  });
  return { heading: 'Awaiting approval', rows, owner: { href: '/output/templates', label: 'Templates' }, overflowed };
}

function renderOverviewGroup(group: OverviewGroup): string {
  const more = group.overflowed ? `\n<p><a href="${group.owner.href}">${group.owner.label}</a></p>` : '';
  return `<section><h2>${escapeHtml(group.heading)}</h2><ul class="rows">
${group.rows.join('\n')}
</ul>${more}</section>`;
}

/**
 * `GET /output`: worst-first failure groups, each row one link, NO group
 * (no heading, no empty list) when it has nothing, no counts, no volume
 * line, no timestamp. All green → exactly `<h1>Overview</h1><p>Nothing
 * needs attention.</p>` after the nav. `now` is injectable for the two
 * threshold groups; the default is the wall clock.
 */
export function renderOverviewPage(sources: OverviewSources, now: Date = new Date()): string {
  const { registryStore, deliveryQueue, backoffPolicy, documentTypes, lifecycle } = sources;
  const queue = deliveryQueue !== undefined && backoffPolicy !== undefined ? { deliveryQueue, backoffPolicy } : undefined;
  const groups: OverviewGroup[] = [
    ...(queue !== undefined ? [poisonGroup(queue.deliveryQueue, queue.backoffPolicy)] : []),
    notArchivedGroup(registryStore, now),
    ...(queue !== undefined ? [stuckGroup(queue.deliveryQueue, queue.backoffPolicy, now)] : []),
    ...(documentTypes !== undefined && lifecycle !== undefined ? [awaitingApprovalGroup(documentTypes, lifecycle)] : []),
  ].filter((g) => g.rows.length > 0);
  const body = groups.length === 0 ? '<p>Nothing needs attention.</p>' : groups.map(renderOverviewGroup).join('\n');
  return renderPage('Overview', `<h1>Overview</h1>${body}`);
}

function facts(rows: Array<[string, string]>): string {
  return `<dl class="facts">
${rows.map(([dt, dd]) => `  <dt>${escapeHtml(dt)}</dt><dd>${dd}</dd>`).join('\n')}
</dl>`;
}

function configuredText(configured: boolean): string {
  return configured ? 'configured' : 'not configured';
}

function senderText(sender: ConsoleFacts['channels']['sender']): string {
  switch (sender.kind) {
    case 'filesystem':
      return `filesystem outbox · ${escapeHtml(sender.outboxDir)}`;
    case 'email':
      return `email · ${escapeHtml(sender.host)}:${sender.port} · TLS ${sender.tls ? 'on' : 'off'} · auth: ${configuredText(sender.authConfigured)}`;
    case 'object-store':
      return `object-store · ${escapeHtml(sender.bucket)} · ${escapeHtml(sender.prefix)} · ${orDash(sender.endpoint)} · credentials: ${configuredText(sender.credentialsConfigured)}`;
  }
}

function archiveText(archive: ConsoleFacts['retention']['archive']): string {
  return archive.kind === 'filesystem'
    ? `filesystem · ${escapeHtml(archive.archiveDir)}`
    : `S3-compatible · ${escapeHtml(archive.bucket)} · ${orDash(archive.endpoint)} · credentials: ${configuredText(archive.credentialsConfigured)}`;
}

/**
 * `GET /output/settings`: four flat groups, each a `<dl class="facts">`,
 * read-only — every value was set at process start (docs/UI-DESIGN.md).
 * No form, no control, no drill-in; nothing here can be changed from the
 * console (a config store would need an ADR).
 */
export function renderSettingsPage(f: ConsoleFacts): string {
  const channels = facts([
    ['delivery sender', senderText(f.channels.sender)],
    ['retry policy', `maxAttempts ${f.channels.retry.maxAttempts} · baseDelayMs ${f.channels.retry.baseDelayMs} · maxDelayMs ${f.channels.retry.maxDelayMs}`],
    ['worker poll', `intervalMs ${f.channels.workerIntervalMs}`],
  ]);
  const retention = facts([
    ...f.retention.documentTypes.map((t): [string, string] => [t.documentType, `${t.years} years${t.isDefault ? ' (default)' : ''}`]),
    ['default', `${f.retention.defaultYears} years`],
    ['archive', archiveText(f.retention.archive)],
    ['registry', `sqlite · ${escapeHtml(f.retention.registry.dbPath)}`],
  ]);
  const renderers = facts(
    f.renderers.map((r): [string, string] => [r.id, `${escapeHtml(r.id)}@${escapeHtml(r.version)}${r.isDefault ? ' · default' : ''}`]),
  );
  const owned = f.access.ownerScopedDocumentTypes;
  const access = facts([
    ['console actor', 'asserted by the reverse proxy via X-Actor-Subject / X-Actor-Role; not authenticated by this runtime'],
    ['CSRF guard', 'Sec-Fetch-Site cross-site → 403'],
    ['document authorization', `AuthorizationPort (owner-scoped types: ${owned.length === 0 ? 'none' : owned.map(escapeHtml).join(', ')})`],
  ]);
  return renderPage(
    'Settings',
    `<h1>Settings</h1>
<section><h2>Channels</h2>
${channels}
</section>
<section><h2>Retention</h2>
${retention}
</section>
<section><h2>Renderers</h2>
${renderers}
</section>
<section><h2>Access</h2>
${access}
</section>`,
  );
}

/** What the Overview/Settings screens need beyond the shared arguments. */
export interface ConsoleHomeOptions {
  consoleFacts?: ConsoleFacts;
  /** Injectable clock for the Overview's two threshold groups. */
  now?: Date;
}

/**
 * Dispatch one already-GET-verified `/output/*` request. Synchronous
 * (RegistryStore is `node:sqlite`, itself synchronous) — no `Promise`
 * needed, unlike `handleEvent`.
 */
export function handleConsoleRequest(
  res: ServerResponse,
  path: string,
  query: URLSearchParams,
  registryStore: RegistryStore,
  deliveryQueue?: DeliveryQueue,
  backoffPolicy?: BackoffPolicy,
  /** The document-type registry's read-only slice: "is this row's type
   * owner-scoped?" (the Registry lock) and the Templates/review
   * screens' metas, content, and rules. Optional so a bare server without
   * a registry still serves the document screens (templates 404). */
  documentTypes?: TemplateSource,
  /** The lifecycle service sharing `registryStore` — log-truth lifecycle
   * for the Templates/review screens. Optional for the same reason. */
  lifecycle?: TemplateLifecycleService,
  /** The transport-resolved actor (review screen's "acting as" line). */
  actor?: Actor,
  home: ConsoleHomeOptions = {},
): void {
  if (path === '/output/') {
    res.writeHead(301, { Location: '/output', 'Content-Length': 0 });
    res.end();
    return;
  }

  if (path === '/output') {
    sendHtml(res, 200, renderOverviewPage({ registryStore, deliveryQueue, backoffPolicy, documentTypes, lifecycle }, home.now));
    return;
  }

  if (path === '/output/settings') {
    if (home.consoleFacts === undefined) {
      sendProblem(res, notFoundProblem(path));
      return;
    }
    sendHtml(res, 200, renderSettingsPage(home.consoleFacts));
    return;
  }

  if (path === '/output/templates' || path.startsWith('/output/templates/')) {
    if (documentTypes === undefined || lifecycle === undefined) {
      sendProblem(res, notFoundProblem(path));
      return;
    }
    if (path === '/output/templates') {
      sendHtml(res, 200, renderTemplatesPage(documentTypes, lifecycle));
      return;
    }
    const key = parseReviewPath(path);
    const subject = key === undefined ? undefined : findGoverned(documentTypes, key);
    if (subject === undefined) {
      sendProblem(res, notFoundProblem(path));
      return;
    }
    sendHtml(res, 200, renderReviewPage(documentTypes, lifecycle, subject, { actor }));
    return;
  }

  if (path === '/output/operations') {
    if (deliveryQueue === undefined || backoffPolicy === undefined) {
      sendProblem(res, notFoundProblem(path));
      return;
    }
    sendHtml(res, 200, renderOperationsPage(deliveryQueue, backoffPolicy, query));
    return;
  }

  if (path === '/output/documents') {
    sendHtml(res, 200, renderDocumentsPage(registryStore, query, documentTypes));
    return;
  }

  if (path.startsWith('/output/documents/')) {
    const docId = decodeURIComponent(path.slice('/output/documents/'.length));
    const row = registryStore.getByDocId(docId);
    if (row === undefined) {
      sendProblem(res, notFoundProblem(path));
      return;
    }
    const hasTrace = registryStore.getTraceLog(docId) !== undefined;
    sendHtml(res, 200, renderDocumentDetailPage(row, hasTrace));
    return;
  }

  if (path.startsWith('/output/trace/')) {
    const id = decodeURIComponent(path.slice('/output/trace/'.length));
    const trace = registryStore.getTraceLog(id);
    if (trace === undefined) {
      sendProblem(res, notFoundProblem(path));
      return;
    }
    sendHtml(res, 200, renderTracePage(id, trace));
    return;
  }

  sendProblem(res, notFoundProblem(path));
}
