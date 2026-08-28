/**
 * FsChannelSender: the default embedded `ChannelSender` (ROADMAP Stage 3
 * "Single-process serve" task; arb-chair ruling: "zero-external-services
 * delivery default"). Writes `input.archiveBytes` to
 * `./data/outbox/<channel>/<docId>-<attempt-or-uuid>.bin` plus a small JSON
 * sidecar (recipients, timestamp) — an inspectable, byte-verifiable
 * delivery record, never a silent no-op. Mirrors `FsArchiveStore` being the
 * default vs `S3ArchiveStore` opt-in: `serve()`'s default `ChannelRouter`
 * (or, for Stage 3's scope, a bare sender — see index.ts) wiring uses this
 * for every channel regardless of the `channel` string. Real
 * `EmailChannelSender`/`ObjectStoreChannelSender` stay available via
 * explicit config for production, unchanged.
 *
 * Channel-agnostic on purpose: unlike `ChannelRouter` (which dispatches to
 * a DIFFERENT sender per channel name and throws on an unknown one), this
 * sender accepts any `input.channel` string and uses it only as a
 * subdirectory name — so it can stand in for every channel at once without
 * needing to know the channel catalog in advance.
 *
 * No payloads in logs (CLAUDE.md): nothing here logs `archiveBytes` or
 * `recipients`; the sidecar file is a delivery record on disk, not a log
 * line.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChannelSendInput, ChannelSender } from './channel-sender.js';

export class FsChannelSender implements ChannelSender {
  constructor(private readonly rootDir: string) {}

  async send(input: ChannelSendInput): Promise<void> {
    const channelDir = join(this.rootDir, input.channel);
    await mkdir(channelDir, { recursive: true });

    const base = `${input.docId}-${randomUUID()}`;
    const binPath = join(channelDir, `${base}.bin`);
    const metaPath = join(channelDir, `${base}.json`);

    await writeFile(binPath, input.archiveBytes);
    await writeFile(
      metaPath,
      JSON.stringify({
        docId: input.docId,
        channel: input.channel,
        recipients: input.recipients,
        deliveredAt: new Date().toISOString(),
      }),
      'utf8',
    );
  }
}
