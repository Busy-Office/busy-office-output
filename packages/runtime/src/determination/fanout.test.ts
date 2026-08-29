/**
 * Bursting/fan-out DoD test (ROADMAP Stage 3: "Fan-out: one event → N
 * resolutions ... DoD: bursting test = fan-out test"). Deliberately wires
 * `determine()` to the REAL mint path — `submitResolution` over a
 * registry-backed `RegistryStore` (not a mock, and not a facade: the old
 * `IdempotencyStore` wrapper was deleted under GAP-16 because it minted a
 * NULL locale) — so this proves the whole path the task asked for: one
 * event matching several rules produces N distinct resolutions, each
 * independently traceable, each minting its own docId — and replaying the
 * exact same event again returns the SAME N docIds, never 2N.
 */
import { describe, expect, it } from 'vitest';
import type { TemplateMeta } from '@busy-office/output-schema';
import { determine, type Resolution } from './determine.js';
import type { DeterminationContext, OutputRule } from './rule-types.js';
import { submitResolution } from '../submit-resolution.js';
import { createSqliteRegistryStore } from '../registry/sqlite-registry-store.js';
import type { RegistryStore } from '../registry/registry-store.js';
import { validInvoice } from '../fixtures.js';

// Mirrors the real fixture set in packages/runtime/rules/output-rules/ +
// rules/templates/ (invoice-default-email + invoice-archival-copy fanOut
// rule, both resolving against invoice-global-v1) — kept test-local so this
// test's assertions don't drift if the real rule files change shape.
const rules: OutputRule[] = [
  {
    id: 'invoice-default-email',
    conditions: { documentType: 'invoice', event: 'invoice.posted' },
    resolution: { channel: 'email', recipients: ['ap-clerk@example.com'] },
  },
  {
    id: 'invoice-archival-copy',
    fanOut: true,
    conditions: { documentType: 'invoice', event: 'invoice.posted' },
    resolution: { channel: 'object-store', recipients: ['archive://invoices/ap'] },
  },
  {
    id: 'invoice-tax-authority-copy',
    fanOut: true,
    conditions: { documentType: 'invoice', event: 'invoice.posted' },
    resolution: { channel: 'object-store', recipients: ['archive://tax-authority'], locale: 'de-DE' },
  },
];

const templates: TemplateMeta[] = [
  { id: 'invoice-global-v1', variant: { documentType: 'invoice' }, version: '1.0.0', lifecycle: 'published', renderer: 'typst' },
];

const ctx: DeterminationContext = {
  documentType: 'invoice',
  businessObject: 'RBKP',
  event: 'invoice.posted',
};

const businessEventKey = {
  businessObject: 'RBKP',
  businessObjectId: '5100001234',
  event: 'invoice.posted',
  templateVersion: '1.0.0',
};

function processEvent() {
  const determination = determine(ctx, rules, templates);
  if (determination.outcome !== 'matched') throw new Error(`expected 'matched', got ${determination.outcome}`);
  return determination;
}

/**
 * Mint one docId per resolution the way server.ts / create-output.ts do:
 * through `submitResolution`. `composition: undefined` = no render/archive
 * backends, so this is the plain `getOrCreateByResolutionKey` mint (see
 * submit-resolution.ts's header) — with `resolution.locale` threaded through.
 */
async function mintAll(
  registryStore: RegistryStore,
  key: typeof businessEventKey,
  resolutions: Resolution[],
) {
  const minted = await Promise.all(
    resolutions.map(async (r) => {
      const { docId, replayed } = await submitResolution(registryStore, undefined, key, r, validInvoice(), 'invoice', undefined);
      return { ruleId: r.ruleId, docId, replayed };
    }),
  );
  return minted.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

function resolutionFor(ruleId: string, overrides: Partial<Resolution> = {}): Resolution {
  return {
    ruleId,
    templateId: 'invoice-global-v1',
    templateVersion: '1.0.0',
    channel: 'object-store',
    recipients: ['archive://invoices/ap'],
    ...overrides,
  };
}

describe('bursting = fan-out: one event → N resolutions, each with a stable docId on replay', () => {
  it('one invoice.posted event fires 3 rules → 3 distinct resolutions, each independently traceable', () => {
    const determination = processEvent();

    expect(determination.resolutions).toHaveLength(3);
    const ruleIds = determination.resolutions.map((r) => r.ruleId).sort();
    expect(ruleIds).toEqual(['invoice-archival-copy', 'invoice-default-email', 'invoice-tax-authority-copy'].sort());

    // Every resolution has its own template, channel, recipients — and its
    // own TRACE entry, not one trace amputated down to the winner.
    expect(determination.trace.resolutions).toHaveLength(3);
    for (const resolutionTrace of determination.trace.resolutions) {
      expect(resolutionTrace.winningTemplateId).toBe('invoice-global-v1');
      expect(resolutionTrace.templates.length).toBeGreaterThan(0);
    }
    // The full candidate rule set is visible collectively, not just what fired.
    expect(determination.trace.rules).toHaveLength(3);
    expect(determination.trace.rules.every((r) => r.matched)).toBe(true);
  });

  it('replaying the exact same event mints the SAME 3 docIds, never 6', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');

    const first = processEvent();
    const firstDocIds = await mintAll(registryStore, businessEventKey, first.resolutions);

    expect(firstDocIds).toHaveLength(3);
    expect(firstDocIds.every((r) => r.replayed === false)).toBe(true);
    expect(new Set(firstDocIds.map((r) => r.docId)).size).toBe(3); // 3 distinct docIds, first sighting

    // Replay: re-run determination (a fresh event with the identical
    // payload/rules) and look each resolution's docId up again.
    const second = processEvent();
    const secondDocIds = await mintAll(registryStore, businessEventKey, second.resolutions);

    expect(secondDocIds).toHaveLength(3); // still 3, not 6
    expect(secondDocIds.every((r) => r.replayed === true)).toBe(true);
    expect(secondDocIds.map((r) => r.docId)).toEqual(firstDocIds.map((r) => r.docId)); // same docIds, in ruleId order
  });

  it('each fanned-out row carries the locale ITS rule resolved, not NULL (GAP-16)', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');

    const minted = await mintAll(registryStore, businessEventKey, processEvent().resolutions);
    const byRule = Object.fromEntries(minted.map((m) => [m.ruleId, registryStore.getByDocId(m.docId)]));

    expect(byRule['invoice-tax-authority-copy']?.locale).toBe('de-DE');
    expect(byRule['invoice-archival-copy']?.locale ?? null).toBeNull(); // rule named no locale — row honestly has none
  });

  it('a different resolution from a DIFFERENT event gets its own docId, never collides with an unrelated rule', async () => {
    const registryStore = createSqliteRegistryStore(':memory:');
    const otherKey = { ...businessEventKey, businessObjectId: '5100009999' };
    const data = validInvoice();

    const a = await submitResolution(registryStore, undefined, businessEventKey, resolutionFor('invoice-archival-copy'), data, 'invoice', undefined);
    const b = await submitResolution(registryStore, undefined, otherKey, resolutionFor('invoice-archival-copy'), data, 'invoice', undefined);
    const c = await submitResolution(
      registryStore,
      undefined,
      businessEventKey,
      resolutionFor('invoice-tax-authority-copy', { recipients: ['archive://tax-authority'], locale: 'de-DE' }),
      data,
      'invoice',
      undefined,
    );

    expect(new Set([a.docId, b.docId, c.docId]).size).toBe(3);
  });
});
