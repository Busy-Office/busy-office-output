/**
 * The read-only console (ROADMAP Stage 3 "Minimal console, read-only",
 * docs/UI-DESIGN.md). Three GET-only, server-rendered HTML screens, no
 * build step, no client framework, no forms besides one plain GET search
 * box — mounted under `/output` by server.ts:
 *
 *   - GET /output/documents            — Registry
 *   - GET /output/documents/:docId     — Document detail
 *   - GET /output/trace/:id            — Rule trace
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
 * this task does not compute them (composition.ts still leaves them
 * unset); the console must be honest about that gap, never fabricate or
 * hide it.
 */
import type { ServerResponse } from 'node:http';
import type { DocumentRegistryRow, RegistryStore } from './registry/registry-store.js';
import type { DeterminationTrace, ResolutionTrace, RuleTraceEntry, TemplateTraceEntry } from './determination/trace.js';
import type { BackoffPolicy, DeliveryJob, DeliveryJobStatus, DeliveryQueue } from './delivery/delivery-queue.js';
import { notFoundProblem } from './problem.js';
import { sendHtml, sendProblem } from './http-helpers.js';

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
    path === '/output/operations'
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

function renderDocumentsPage(registryStore: RegistryStore, query: URLSearchParams): string {
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
      const lock = row.documentType === 'payslip' ? ' 🔒' : '';
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
): void {
  if (path === '/output/operations') {
    if (deliveryQueue === undefined || backoffPolicy === undefined) {
      sendProblem(res, notFoundProblem(path));
      return;
    }
    sendHtml(res, 200, renderOperationsPage(deliveryQueue, backoffPolicy, query));
    return;
  }

  if (path === '/output/documents') {
    sendHtml(res, 200, renderDocumentsPage(registryStore, query));
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
