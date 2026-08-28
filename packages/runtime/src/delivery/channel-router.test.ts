/**
 * ChannelRouter (ROADMAP Stage 3, "Channels: email + object-store only").
 * Proves dispatch by `input.channel` and that an unknown channel is a hard
 * error, never a silent no-op.
 */
import { describe, expect, it } from 'vitest';
import type { ChannelSendInput, ChannelSender } from './channel-sender.js';
import { ChannelRouter } from './channel-router.js';

class RecordingSender implements ChannelSender {
  public calls: ChannelSendInput[] = [];
  async send(input: ChannelSendInput): Promise<void> {
    this.calls.push(input);
  }
}

function input(overrides: Partial<ChannelSendInput> = {}): ChannelSendInput {
  return {
    archiveBytes: new Uint8Array([1]),
    recipients: ['x'],
    channel: 'email',
    docId: 'doc-1',
    ...overrides,
  };
}

describe('ChannelRouter', () => {
  it('dispatches to the sender registered for input.channel', async () => {
    const email = new RecordingSender();
    const objectStore = new RecordingSender();
    const router = new ChannelRouter({ email, 'object-store': objectStore });

    await router.send(input({ channel: 'email' }));
    await router.send(input({ channel: 'object-store', docId: 'doc-2' }));

    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].docId).toBe('doc-1');
    expect(objectStore.calls).toHaveLength(1);
    expect(objectStore.calls[0].docId).toBe('doc-2');
  });

  it('throws (never silently no-ops) on an unrecognized channel', async () => {
    const router = new ChannelRouter({ email: new RecordingSender() });

    await expect(router.send(input({ channel: 'fax' }))).rejects.toThrow(/fax/);
  });
});
