/**
 * ObjectStoreChannelSender: the "object-store" `ChannelSender`
 * implementation (ROADMAP Stage 3, "Channels: email + object-store only").
 * Uses `@aws-sdk/client-s3`, already a `packages/runtime` dependency (see
 * `S3ArchiveStore`).
 *
 * Delivery is not archiving: this class deliberately does NOT reuse
 * `S3ArchiveStore`. It writes to a distinct bucket and/or key prefix (the
 * caller's choice via `options.bucket`/`options.keyPrefix`) so a delivered
 * copy can never be mistaken for, or accidentally overwrite, the immutable
 * archived artifact `S3ArchiveStore` owns. The default `keyPrefix` is
 * `"deliveries/"`, distinct from `S3ArchiveStore`'s bare-UUID convention.
 * Each key is `${keyPrefix}${docId}/${randomUUID()}` — namespaced by docId
 * so every delivered copy for a document is easy to find, and unique per
 * attempt so retries never collide on one key.
 *
 * Testing constraint (same as `S3ArchiveStore`): there is no live
 * S3/MinIO instance in this environment, and
 * `object-store-channel-sender.test.ts` never touches the network. The
 * underlying client is injectable (`options.client`), narrowed to
 * `Pick<S3Client, 'send'>` — the exact `S3ClientLike` pattern
 * `S3ArchiveStore` established.
 *
 * No payloads in logs (CLAUDE.md golden rule): this file never logs
 * `archiveBytes` or `recipients`.
 */
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3ClientLike } from '../archive/s3-archive-store.js';
import type { ChannelSendInput, ChannelSender } from './channel-sender.js';

export interface ObjectStoreChannelSenderOptions {
  /** Bucket delivered copies are written to. Should be distinct from any
   * archive-store bucket — delivery is not archiving. */
  bucket: string;
  /** Prepended to every generated object key. Defaults to `"deliveries/"`,
   * distinct from `S3ArchiveStore`'s bare-UUID convention. */
  keyPrefix?: string;
  /** Inject a client (real or fake) instead of constructing one — the
   * mechanism this sender's tests use to avoid all network I/O. */
  client?: S3ClientLike;
  /** AWS region for a constructed client. Ignored if `client` is provided. */
  region?: string;
  /** S3-compatible endpoint (MinIO, R2, ...) for a constructed client.
   * Ignored if `client` is provided. */
  endpoint?: string;
  /** Path-style addressing, required by most S3-compatible endpoints.
   * Defaults to `true` when `endpoint` is set, `false` otherwise. Ignored
   * if `client` is provided. */
  forcePathStyle?: boolean;
  /** Content type applied to every written object. Defaults to
   * `"application/pdf"`. */
  contentType?: string;
}

export class ObjectStoreChannelSender implements ChannelSender {
  private readonly client: S3ClientLike;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly contentType: string;

  constructor(options: ObjectStoreChannelSenderOptions) {
    if (typeof options.bucket !== 'string' || options.bucket.trim() === '') {
      throw new TypeError('ObjectStoreChannelSender requires a non-empty bucket name.');
    }
    this.bucket = options.bucket;
    this.keyPrefix = options.keyPrefix ?? 'deliveries/';
    this.contentType = options.contentType ?? 'application/pdf';
    this.client =
      options.client ??
      new S3Client({
        region: options.region ?? 'us-east-1',
        endpoint: options.endpoint,
        forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      });
  }

  async send(input: ChannelSendInput): Promise<void> {
    if (input.archiveBytes.length === 0) {
      throw new Error(`ObjectStoreChannelSender.send: docId "${input.docId}" has empty archiveBytes.`);
    }
    const key = `${this.keyPrefix}${input.docId}/${randomUUID()}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.archiveBytes,
        ContentType: this.contentType,
        Metadata: { 'doc-id': input.docId, channel: input.channel },
      }),
    );
  }
}
