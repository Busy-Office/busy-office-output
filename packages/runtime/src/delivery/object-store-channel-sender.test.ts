/**
 * ObjectStoreChannelSender (ROADMAP Stage 3, "Channels: email +
 * object-store only — DoD: both deliver the archived bytes"). NO LIVE
 * NETWORK: every test injects a fake `S3ClientLike` whose `send()`
 * inspects the command it receives — there is no live S3/MinIO instance in
 * this environment (same convention as `s3-archive-store.test.ts`).
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import type { S3ClientLike } from '../archive/s3-archive-store.js';
import type { ChannelSendInput } from './channel-sender.js';
import { ObjectStoreChannelSender } from './object-store-channel-sender.js';

function fakeS3Client() {
  const puts: Array<{ Bucket: string; Key: string; Body: unknown; ContentType?: string }> = [];
  const client: S3ClientLike = {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const cmdInput = command.input;
        puts.push({
          Bucket: cmdInput.Bucket as string,
          Key: cmdInput.Key as string,
          Body: cmdInput.Body,
          ContentType: cmdInput.ContentType,
        });
        return {};
      }
      throw new Error(`fakeS3Client: unexpected command ${(command as { constructor: { name: string } }).constructor.name}`);
    }) as unknown as S3ClientLike['send'],
  };
  return { client, puts };
}

function input(overrides: Partial<ChannelSendInput> = {}): ChannelSendInput {
  return {
    archiveBytes: new Uint8Array([1, 2, 3, 4, 5]),
    recipients: ['warehouse-inbox'],
    channel: 'object-store',
    docId: 'doc-456',
    ...overrides,
  };
}

describe('ObjectStoreChannelSender', () => {
  it('DoD: PUTs the archived bytes byte-identical, to a bucket/key distinct from the archive-store convention', async () => {
    const { client, puts } = fakeS3Client();
    const sender = new ObjectStoreChannelSender({ bucket: 'delivery-bucket', client });
    const archiveBytes = new Uint8Array([100, 101, 102, 103]);

    await sender.send(input({ archiveBytes, docId: 'doc-456' }));

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(puts).toHaveLength(1);
    expect(puts[0].Bucket).toBe('delivery-bucket');
    // Key is namespaced under the "deliveries/" prefix (distinct from
    // S3ArchiveStore's bare-UUID keys) and includes the docId.
    expect(puts[0].Key.startsWith('deliveries/doc-456/')).toBe(true);
    expect(Buffer.compare(Buffer.from(puts[0].Body as Uint8Array), Buffer.from(archiveBytes))).toBe(0);
  });

  it('two deliveries for the same docId get distinct keys (no collision on retry)', async () => {
    const { client, puts } = fakeS3Client();
    const sender = new ObjectStoreChannelSender({ bucket: 'delivery-bucket', client });
    const sameDocInput = input({ docId: 'doc-789' });

    await sender.send(sameDocInput);
    await sender.send(sameDocInput);

    expect(puts).toHaveLength(2);
    expect(puts[0].Key).not.toBe(puts[1].Key);
    expect(puts[0].Key.startsWith('deliveries/doc-789/')).toBe(true);
    expect(puts[1].Key.startsWith('deliveries/doc-789/')).toBe(true);
  });

  it('respects a custom keyPrefix and contentType', async () => {
    const { client, puts } = fakeS3Client();
    const sender = new ObjectStoreChannelSender({
      bucket: 'delivery-bucket',
      keyPrefix: 'custom-deliveries/',
      contentType: 'application/pdf',
      client,
    });

    await sender.send(input({ docId: 'doc-999' }));

    expect(puts[0].Key.startsWith('custom-deliveries/doc-999/')).toBe(true);
    expect(puts[0].ContentType).toBe('application/pdf');
  });
});
