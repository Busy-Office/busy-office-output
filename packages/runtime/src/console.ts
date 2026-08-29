/**
 * The console (ROADMAP Stage 3 "Minimal console, read-only", extended by
 * Stage 5 task 4 "Review-and-approve screen"; docs/UI-DESIGN.md).
 * Server-rendered HTML screens, no build step, no client framework, no
 * client JS — mounted under `/output` by server.ts:
 *
 *   - GET /output/documents            — Registry
 *   - GET /output/documents/:docId     — Document detail
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
 * inputHash/outputHash/rendererVersion are rendered "—" wherever null —
 * inputHash/outputHash are not yet computed (composition.ts leaves them
 * unset); rendererVersion (`rendererId@version`, GAP-15) is written by
 * `archiveArtifact` at archive time, so it is null only for DRAFT rows and
 * rows archived before it was persisted. The console must be honest about
 * those nulls, never fabricate or hide them.
 */
import type { ServerResponse } from 'node:http';
import type { DocNode, TemplateLifecycle, TemplateMeta, VariantKey } from '@busy-office/output-schema';
import type { DocumentRegistryRow, RegistryStore, TemplateLifecycleEvent } from './registry/registry-store.js';
import type { DeterminationTrace, ResolutionTrace, RuleTraceEntry, TemplateTraceEntry } from './determination/trace.js';
import type { BackoffPolicy, DeliveryJob, DeliveryJobStatus, DeliveryQueue } from './delivery/delivery-queue.js';
import type { Actor, OwnerScopeSource } from './authorization/authorization-port.js';
import type { OutputRule } from './determination/rule-types.js';
import { CHANNELS_REQUIRING_MESSAGE, type MessageTemplate, type MessageTemplateMeta } from './message/message-template.js';
import type { TemplateLifecycleKey, TemplateLifecycleService } from './lifecycle/template-lifecycle.js';
import { standingApproval, type TransitionRefusal } from './lifecycle/transitions.js';
import { formatDiffRow, structuralDiff, type DiffRow } from './lifecycle/structural-diff.js';
import { actorRequiredProblem, crossSiteRequestProblem, notFoundProblem, unknownReviewActionProblem } from './problem.js';
import { sendHtml, sendProblem } from './http-helpers.js';

/**
 * The read-only slice of `DocumentTypeRegistry` the console sees (Stage 5
 * task 4 arb-chair ruling): satisfied by the real registry, but with no
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

export function isConsolePath(path: string): boolean {
  return (
    path === '/output/documents' ||
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

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
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
      // Owner-scoped rows (the registered type supplies an `ownerIdPath`,
      // GAP-17 — the built-in payslip does) carry the lock glyph. No
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
  <div class="trichotomy-row">Reproduce (archive bytes, stamped) — not yet available in this console</div>
  <div class="trichotomy-row">Regenerate (current template+data, new doc) — not yet available in this console</div>
  <div class="trichotomy-row">Reissue (new event) — not yet available in this console</div>
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
// Templates list + Review-and-approve (Stage 5 task 4)
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
 * and whose key differs (GAP-20 visibility: the live version stays live
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
   * owner-scoped?" (the Registry lock, GAP-17) and the Templates/review
   * screens' metas, content, and rules. Optional so a bare server without
   * a registry still serves the document screens (templates 404). */
  documentTypes?: TemplateSource,
  /** The lifecycle service sharing `registryStore` — log-truth lifecycle
   * for the Templates/review screens. Optional for the same reason. */
  lifecycle?: TemplateLifecycleService,
  /** The transport-resolved actor (review screen's "acting as" line). */
  actor?: Actor,
): void {
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
