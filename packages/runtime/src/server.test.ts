import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngressServer } from './index.js';
import {
  invoiceMissingDueDate,
  purchaseOrderMissingPoNumber,
  sampleBusinessEventKey,
  unmatchedBusinessEventKey,
  validInvoice,
  validPayslip,
  validPurchaseOrder,
  withBusinessEvent,
  wrapCloudEvent,
} from './fixtures.js';

describe('POST /event ingress + contract validation', () => {
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
    const contentType = res.headers.get('content-type');
    const json = await res.json();
    return { status: res.status, contentType, json };
  }

  it('rejects a purchase-order payload missing a required field (400 problem+json)', async () => {
    const { status, contentType, json } = await post(purchaseOrderMissingPoNumber());

    expect(status).toBe(400);
    expect(contentType).toContain('application/problem+json');
    expect(json).toMatchObject({
      type: expect.stringContaining('invalid-contract'),
      title: expect.any(String),
      status: 400,
      detail: expect.any(String),
    });
    expect(Array.isArray(json.errors)).toBe(true);
    expect(json.errors.length).toBeGreaterThan(0);
    // Identifies the missing field specifically, not a raw ajv dump.
    const found = json.errors.some(
      (e: { keyword: string; message: string }) =>
        e.keyword === 'required' && e.message.includes('poNumber'),
    );
    expect(found).toBe(true);
  });

  it('rejects an unrecognized documentType with 400, not a 500 crash', async () => {
    const { status, contentType, json } = await post({
      schemaVersion: '1.0.0',
      documentType: 'delivery-note', // not a known contract
      header: {},
    });

    expect(status).toBe(400);
    expect(contentType).toContain('application/problem+json');
    expect(json.type).toContain('unknown-document-type');
    expect(json.status).toBe(400);
  });

  it('rejects a payload with no documentType at all with 400, not a 500 crash', async () => {
    const { status, json } = await post({ foo: 'bar' });
    expect(status).toBe(400);
    expect(json.type).toContain('unknown-document-type');
  });

  it('does not reject a malformed (non-JSON) body with a 500', async () => {
    const res = await fetch(`${baseUrl}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('accepts a genuinely valid purchase-order payload', async () => {
    const { status, json } = await post(
      withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey()),
    );
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(json.status).toBe('accepted');
    // Determination result + its TRACE are carried on the successful
    // response too (HLD §9: TRACE isn't restricted to failures).
    expect(json.determination).toMatchObject({
      ruleId: expect.any(String),
      templateId: expect.any(String),
      channel: expect.any(String),
      recipients: expect.any(Array),
    });
    expect(json.trace).toMatchObject({ outcome: 'matched' });
    expect(Array.isArray(json.trace.rules)).toBe(true);
    expect(json.trace.rules.length).toBeGreaterThan(0);
  });

  it('rejects an invoice payload missing a required field (400 problem+json)', async () => {
    const { status, contentType, json } = await post(invoiceMissingDueDate());

    expect(status).toBe(400);
    expect(contentType).toContain('application/problem+json');
    expect(json.errors.some((e: { message: string }) => e.message.includes('dueDate'))).toBe(true);
  });

  it('accepts a genuinely valid invoice payload', async () => {
    const { status, json } = await post(
      withBusinessEvent(validInvoice(), sampleBusinessEventKey({ businessObject: 'RBKP', event: 'invoice.posted' })),
    );
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(json.status).toBe('accepted');
  });

  it('accepts a genuinely valid payslip payload when the event names its recipient (caller-supplied master data)', async () => {
    const { status, json } = await post({
      ...withBusinessEvent(validPayslip(), sampleBusinessEventKey({ businessObject: 'PSLIP', event: 'payslip.issued' })),
      determination: { recipients: ['emp-0000001@example.com'], locale: 'de-DE' },
    });
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(json.status).toBe('accepted');
    expect(json.determination).toMatchObject({ channel: 'email', recipients: ['emp-0000001@example.com'], locale: 'de-DE' });
    expect(json.trace.resolutions[0]).toMatchObject({ recipientsSource: 'context' });
  });

  it('rejects a payslip whose rule is channel-only and whose event names no recipient: 422 unresolved-recipients with the TRACE (never an empty send)', async () => {
    const { status, contentType, json } = await post(
      withBusinessEvent(validPayslip(), sampleBusinessEventKey({ businessObject: 'PSLIP', businessObjectId: 'PS-NO-RCPT', event: 'payslip.issued' })),
    );
    expect(status).toBe(422);
    expect(contentType).toContain('application/problem+json');
    expect(json.type).toBe('https://busy-office.dev/problems/unresolved-recipients');
    expect(json.trace.outcome).toBe('unresolved-recipients');
    expect(json.trace.firingRuleIds).toContain('payslip-default-email');
    expect(json.trace.resolutions.find((r: { ruleId: string }) => r.ruleId === 'payslip-default-email')).toMatchObject({
      recipientsSource: 'none',
      winningTemplateId: 'payslip-global-v1',
    });
  });

  it('the TRACE never carries recipient addresses (PII) — only their source', async () => {
    const address = 'emp-0000042@example.com';
    const { json } = await post({
      ...withBusinessEvent(validPayslip(), sampleBusinessEventKey({ businessObject: 'PSLIP', businessObjectId: 'PS-TRACE-PII', event: 'payslip.issued' })),
      determination: { recipients: [address] },
    });
    expect(JSON.stringify(json.trace)).not.toContain(address);
    expect(json.trace.resolutions[0].recipientsSource).toBe('context');
  });

  it('ignores a malformed determination.recipients (not an array of non-empty strings) rather than sending to it', async () => {
    const { status, json } = await post({
      ...withBusinessEvent(validPayslip(), sampleBusinessEventKey({ businessObject: 'PSLIP', businessObjectId: 'PS-BAD-RCPT', event: 'payslip.issued' })),
      determination: { recipients: ['ok@example.com', ''] },
    });
    expect(status).toBe(422);
    expect(json.type).toBe('https://busy-office.dev/problems/unresolved-recipients');
  });

  it('accepts a raw purchase-order payload wrapped in a CloudEvents 1.0 envelope, identically to the raw shape', async () => {
    const inner = withBusinessEvent(validPurchaseOrder(), sampleBusinessEventKey({ businessObjectId: '4500009999' }));
    const { status, json } = await post(wrapCloudEvent(inner));

    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(json.status).toBe('accepted');
    expect(json.documentType).toBe('purchase-order');
    expect(json.determination.channel).toEqual(expect.any(String));
  });

  it('rejects a body claiming CloudEvents specversion "1.0" but missing required attributes (400, not 500)', async () => {
    const res = await fetch(`${baseUrl}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specversion: '1.0', data: { foo: 'bar' } }), // missing id/source/type
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const json = await res.json();
    expect(json.type).toContain('malformed-cloudevents-envelope');
  });

  it('a CloudEvents-wrapped invalid contract still surfaces the same 400 invalid-contract problem as the raw path', async () => {
    const { status, json } = await post(wrapCloudEvent(purchaseOrderMissingPoNumber()));
    expect(status).toBe(400);
    expect(json.type).toContain('invalid-contract');
  });

  it('no rule matches the event → 422 problem+json (never a silent 2xx), carrying a non-empty rule TRACE', async () => {
    const { status, contentType, json } = await post(
      withBusinessEvent(validPurchaseOrder(), unmatchedBusinessEventKey()),
    );

    expect(status).toBe(422);
    expect(status < 200 || status >= 300).toBe(true); // never a 2xx acceptance
    expect(contentType).toContain('application/problem+json');
    expect(json.type).toContain('no-rule-match');
    expect(json.status).toBe(422);
    expect(Array.isArray(json.trace?.rules)).toBe(true);
    expect(json.trace.rules.length).toBeGreaterThan(0);
    expect(json.trace.outcome).toBe('no-rule-match');
    // Every considered rule explains itself — not a bare boolean.
    for (const entry of json.trace.rules) {
      expect(typeof entry.matched).toBe('boolean');
      expect(Array.isArray(entry.reasons)).toBe(true);
      expect(entry.reasons.length).toBeGreaterThan(0);
    }
  });

  it('a no-rule-match event never mints a registry docId (determination runs before idempotency)', async () => {
    const key = unmatchedBusinessEventKey({ businessObjectId: '4500055555' });
    const first = await post(withBusinessEvent(validPurchaseOrder(), key));
    const second = await post(withBusinessEvent(validPurchaseOrder(), key));
    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(first.json.docId).toBeUndefined();
    expect(second.json.docId).toBeUndefined();
  });

  it('returns 404 problem+json for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/nope`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('returns 405 problem+json for GET /event', async () => {
    const res = await fetch(`${baseUrl}/event`, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});
