/**
 * Idempotency on BusinessEventKey, end-to-end through POST /event (ROADMAP
 * Stage 3: "replayed event returns existing docId; write this test first").
 *
 * This is THE idempotency-guarantee test: it goes through the real mint
 * path (`handleEvent` -> `submitResolution` -> `RegistryStore`), the same
 * one `serve()` and the embedded port use. The store backing it is the
 * durable document registry (registry/), defaulted here to an in-memory
 * (`:memory:`) SQLite instance for test speed/isolation. (The former
 * `IdempotencyStore` facade and its unit test were deleted under GAP-16 —
 * the facade was on no live path and minted a NULL locale; the contract it
 * proved lives here now.) Persistence-across-restart is covered in
 * registry/sqlite-registry-store.test.ts.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngressServer } from './index.js';
import { sampleBusinessEventKey, validPurchaseOrder, withBusinessEvent } from './fixtures.js';

describe('POST /event idempotency on BusinessEventKey', () => {
  let baseUrl: string;
  const server = createIngressServer();

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function post(body: unknown) {
    const res = await fetch(`${baseUrl}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it('replayed event (same four-tuple) returns the SAME docId as the first, and signals replay', async () => {
    const payload = withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey());

    const first = await post(payload);
    expect(first.status).toBe(202);
    expect(typeof first.json.docId).toBe('string');
    expect(first.json.replayed).toBe(false);

    const second = await post(payload);
    expect(second.status).toBe(200);
    expect(second.json.docId).toBe(first.json.docId);
    expect(second.json.replayed).toBe(true);
  });

  it('a different businessObjectId is a distinct event: its own fresh docId', async () => {
    const first = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'PO-0000001' })),
    );
    const other = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'PO-0000002' })),
    );

    expect(first.status).toBe(202);
    expect(other.status).toBe(202);
    expect(other.json.docId).not.toBe(first.json.docId);
  });

  it('templateVersion is part of the key: same object/event, different template version, different docId', async () => {
    const first = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'PO-0000003', templateVersion: '1.0.0' })),
    );
    const reprocessedOnNewTemplate = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: 'PO-0000003', templateVersion: '2.0.0' })),
    );

    expect(first.status).toBe(202);
    expect(reprocessedOnNewTemplate.status).toBe(202);
    expect(reprocessedOnNewTemplate.json.replayed).toBe(false);
    expect(reprocessedOnNewTemplate.json.docId).not.toBe(first.json.docId);
  });

  it('rejects a contract-valid payload missing the businessEvent envelope with 400, not a silent accept', async () => {
    const { status, json } = await post(validPurchaseOrder());

    expect(status).toBe(400);
    expect(json.type).toContain('missing-business-event');
  });
});
