/**
 * S3ArchiveStore: the S3-compatible `ArchiveStore` implementation
 * (ROADMAP Stage 3, "Archive store (FS + S3-compatible)"). Uses
 * `@aws-sdk/client-s3` — a `packages/runtime`-only dependency (CLAUDE.md:
 * `@busy-office/output-schema` stays zero-runtime-dependency; this package
 * is not that one). Works against real AWS S3 or any S3-compatible
 * endpoint (MinIO, Cloudflare R2, ...) via the `endpoint`/`forcePathStyle`
 * options, which is exactly what those alternatives need from the SDK.
 *
 * Testing constraint (explicitly called out by the task that produced this
 * file): there is no live S3/MinIO instance in this environment, and
 * `s3-archive-store.test.ts` never touches the network. The underlying
 * client is injectable (`options.client`) — tests pass a fake object whose
 * `send()` inspects the command it's given and returns a canned response,
 * proving retentionUntil validation, key construction, and error handling
 * without ever constructing a real `S3Client` or opening a socket. Only
 * `client` typed as `Pick<S3Client, 'send'>` is required, precisely so a
 * minimal fake can stand in for it.
 *
 * archiveRef shape: `s3://<bucket>/<key>` — self-describing (retrieve()
 * doesn't need to be told which bucket separately) and immediately
 * recognizable in logs/registry rows as an S3 pointer, distinct from the
 * FS backend's bare relative-path convention.
 */
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { assertValidRetentionUntil } from './archive-store.js';
import type { ArchiveInput, ArchiveStore } from './archive-store.js';

/** The subset of `S3Client` this store actually calls — narrow on purpose
 * so a test fake only has to implement `send()`, not the whole SDK client
 * surface. A real `S3Client` satisfies this trivially. */
export type S3ClientLike = Pick<S3Client, 'send'>;

export interface S3ArchiveStoreOptions {
  /** Bucket every archived artifact is written to and read from. */
  bucket: string;
  /** Prepended to every generated object key, e.g. "artifacts/". Empty by default. */
  keyPrefix?: string;
  /** Inject a client (real or fake) instead of constructing one — the
   * mechanism this store's tests use to avoid all network I/O. */
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
}

export class S3ArchiveStore implements ArchiveStore {
  private readonly client: S3ClientLike;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(options: S3ArchiveStoreOptions) {
    if (typeof options.bucket !== 'string' || options.bucket.trim() === '') {
      throw new TypeError('S3ArchiveStore requires a non-empty bucket name.');
    }
    this.bucket = options.bucket;
    this.keyPrefix = options.keyPrefix ?? '';
    this.client =
      options.client ??
      new S3Client({
        region: options.region ?? 'us-east-1',
        endpoint: options.endpoint,
        forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      });
  }

  async archive(input: ArchiveInput): Promise<string> {
    const retentionUntil = assertValidRetentionUntil(input.retentionUntil);
    if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) {
      throw new TypeError('archive() requires non-empty artifact bytes.');
    }
    if (typeof input.mediaType !== 'string' || input.mediaType.trim() === '') {
      throw new TypeError('archive() requires a non-empty mediaType.');
    }

    const key = `${this.keyPrefix}${randomUUID()}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.bytes,
        ContentType: input.mediaType,
        // S3 object metadata values must be strings; this is a convenience
        // mirror of the registry's own retentionUntil column (source of
        // truth), not a substitute for it.
        Metadata: { 'retention-until': retentionUntil },
      }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async retrieve(archiveRef: string): Promise<Uint8Array> {
    const key = this.parseKey(archiveRef);
    const result = (await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )) as GetObjectCommandOutput;

    if (result.Body === undefined) {
      throw new Error(`S3ArchiveStore.retrieve: no Body for archiveRef "${archiveRef}".`);
    }
    // GetObjectCommandOutput.Body is an SdkStream — transformToByteArray()
    // is the SDK's own way to fully buffer it, present on a real response
    // and easy for a test fake to implement without pulling in Node stream
    // machinery.
    const body = result.Body as { transformToByteArray: () => Promise<Uint8Array> };
    return await body.transformToByteArray();
  }

  private parseKey(archiveRef: string): string {
    const prefix = `s3://${this.bucket}/`;
    if (!archiveRef.startsWith(prefix)) {
      throw new Error(
        `S3ArchiveStore.retrieve: archiveRef "${archiveRef}" does not belong to bucket "${this.bucket}".`,
      );
    }
    return archiveRef.slice(prefix.length);
  }
}
