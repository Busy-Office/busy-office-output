import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngressServer } from './index.js';
import {
  invoiceMissingDueDate,
  purchaseOrderMissingPoNumber,
  sampleBusinessEventKey,
  validInvoice,
  validPayslip,
  validPurchaseOrder,
  withBusinessEvent,
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

  it('accepts a genuinely valid payslip payload', async () => {
    const { status, json } = await post(
      withBusinessEvent(validPayslip(), sampleBusinessEventKey({ businessObject: 'PSLIP', event: 'payslip.issued' })),
    );
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(json.status).toBe('accepted');
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
