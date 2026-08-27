/**
 * S3ArchiveStore (ROADMAP Stage 3, "Archive store (FS + S3-compatible)
 * with mandatory retentionUntil"). NO LIVE NETWORK: every test injects a
 * fake `S3ClientLike` whose `send()` inspects the command it receives and
 * returns a canned response — there is no live S3/MinIO instance in this
 * environment (per the task that produced this file), and this store's
 * client is injectable specifically so retentionUntil validation, key
 * construction, and error handling can be proven without one.
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3ArchiveStore } from './s3-archive-store.js';
import type { S3ClientLike } from './s3-archive-store.js';

/** A fake S3 client: records every PutObject call, serves GetObject from
 * an in-memory map. Implements only `send()` — the one method
 * `S3ClientLike` requires — never opens a socket. */
function fakeS3Client() {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const puts: Array<{ Bucket: string; Key: string; ContentType?: string; Metadata?: Record<string, string> }> = [];

  const client: S3ClientLike = {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const input = command.input;
        objects.set(`${input.Bucket}/${input.Key}`, {
          body: input.Body as Uint8Array,
          contentType: input.ContentType ?? '',
        });
        puts.push({
          Bucket: input.Bucket as string,
          Key: input.Key as string,
          ContentType: input.ContentType,
          Metadata: input.Metadata,
        });
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const input = command.input;
        const found = objects.get(`${input.Bucket}/${input.Key}`);
        if (found === undefined) {
          const err = new Error('NoSuchKey');
          err.name = 'NoSuchKey';
          throw err;
        }
        return {
          Body: {
            transformToByteArray: async () => found.body,
          },
        };
      }
      throw new Error(`fakeS3Client: unexpected command ${(command as { constructor: { name: string } }).constructor.name}`);
    }) as unknown as S3ClientLike['send'],
  };

  return { client, puts };
}

describe('S3ArchiveStore', () => {
  it('archiving without retentionUntil fails (DoD) — never calls send()', async () => {
    const { client } = fakeS3Client();
    const store = new S3ArchiveStore({ bucket: 'artifacts', client });
    const bytes = new TextEncoder().encode('fake pdf bytes');

    // @ts-expect-error deliberately omitting the mandatory field
    await expect(store.archive({ bytes, mediaType: 'application/pdf' })).rejects.toThrow(TypeError);
    await expect(
      store.archive({ bytes, mediaType: 'application/pdf', retentionUntil: 'nope' }),
    ).rejects.toThrow(TypeError);

    expect(client.send).not.toHaveBeenCalled();
  });

  it('rejects a missing/empty bucket at construction', () => {
    expect(() => new S3ArchiveStore({ bucket: '' })).toThrow(TypeError);
  });

  it('archive() builds a key under the bucket and returns an s3:// ref', async () => {
    const { client, puts } = fakeS3Client();
    const store = new S3ArchiveStore({ bucket: 'artifacts', keyPrefix: 'po/', client });
    const bytes = new TextEncoder().encode('fake pdf bytes');

    const ref = await store.archive({ bytes, mediaType: 'application/pdf', retentionUntil: '2030-01-01T00:00:00Z' });

    expect(ref.startsWith('s3://artifacts/po/')).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].Bucket).toBe('artifacts');
    expect(puts[0].Key.startsWith('po/')).toBe(true);
    expect(puts[0].ContentType).toBe('application/pdf');
    expect(puts[0].Metadata).toMatchObject({ 'retention-until': '2030-01-01T00:00:00Z' });
  });

  it('round-trips through the fake client: archive() then retrieve()', async () => {
    const { client } = fakeS3Client();
    const store = new S3ArchiveStore({ bucket: 'artifacts', client });
    const bytes = new TextEncoder().encode('fake pdf bytes for round-trip');

    const ref = await store.archive({ bytes, mediaType: 'application/pdf', retentionUntil: '2030-01-01T00:00:00Z' });
    const retrieved = await store.retrieve(ref);

    expect(Buffer.from(retrieved)).toEqual(Buffer.from(bytes));
  });

  it('retrieve() rejects an archiveRef from a different bucket', async () => {
    const { client } = fakeS3Client();
    const store = new S3ArchiveStore({ bucket: 'artifacts', client });

    await expect(store.retrieve('s3://other-bucket/some-key')).rejects.toThrow();
  });

  it('retrieve() propagates the underlying client error for an unknown key', async () => {
    const { client } = fakeS3Client();
    const store = new S3ArchiveStore({ bucket: 'artifacts', client });

    await expect(store.retrieve('s3://artifacts/never-existed')).rejects.toThrow('NoSuchKey');
  });

  it('rejects empty bytes without calling send()', async () => {
    const { client } = fakeS3Client();
    const store = new S3ArchiveStore({ bucket: 'artifacts', client });

    await expect(
      store.archive({ bytes: new Uint8Array(0), mediaType: 'application/pdf', retentionUntil: '2030-01-01T00:00:00Z' }),
    ).rejects.toThrow(TypeError);
    expect(client.send).not.toHaveBeenCalled();
  });
});
