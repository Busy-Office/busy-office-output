/**
 * EmailChannelSender (ROADMAP Stage 3, "Channels: email + object-store
 * only — DoD: both deliver the archived bytes"). NO LIVE NETWORK: every
 * test injects a fake `TransporterLike` whose `sendMail()` records what it
 * received — there is no live SMTP server in this environment.
 *
 * GAP-10: subject/body come off the delivery job (`input.message`),
 * rendered at enqueue from the resolved message template. The sender has
 * no default subject — a job without a message is refused.
 */
import { describe, expect, it } from 'vitest';
import type { ChannelSendInput } from './channel-sender.js';
import { EmailChannelSender } from './email-channel-sender.js';
import type { TransporterLike } from './email-channel-sender.js';

function fakeTransporter() {
  const calls: unknown[] = [];
  const transporter: TransporterLike = {
    sendMail: (async (message: unknown) => {
      calls.push(message);
      return { messageId: 'fake-message-id' };
    }) as unknown as TransporterLike['sendMail'],
  };
  return { transporter, calls };
}

function input(overrides: Partial<ChannelSendInput> = {}): ChannelSendInput {
  return {
    archiveBytes: new Uint8Array([1, 2, 3, 4, 5]),
    recipients: ['ap-clerk@example.com'],
    channel: 'email',
    docId: 'doc-123',
    message: { subject: 'Purchase order PO-1', body: 'Purchase order PO-1 is attached.\n' },
    ...overrides,
  };
}

describe('EmailChannelSender', () => {
  it('DoD: delivers the archived bytes as a byte-identical attachment to the given recipients', async () => {
    const { transporter, calls } = fakeTransporter();
    const sender = new EmailChannelSender({ from: 'output@example.com', transporter });
    const archiveBytes = new Uint8Array([10, 20, 30, 40, 50, 60]);

    await sender.send(input({ archiveBytes, recipients: ['a@example.com', 'b@example.com'] }));

    expect(calls).toHaveLength(1);
    const sent = calls[0] as {
      from: string;
      to: string[];
      attachments: Array<{ content: Buffer }>;
    };
    expect(sent.from).toBe('output@example.com');
    expect(sent.to).toEqual(['a@example.com', 'b@example.com']);
    expect(sent.attachments).toHaveLength(1);
    expect(Buffer.compare(sent.attachments[0].content, Buffer.from(archiveBytes))).toBe(0);
  });

  it('GAP-10: the subject and plain-text body are exactly the rendered message on the job — nothing hardcoded, nothing re-rendered', async () => {
    const { transporter, calls } = fakeTransporter();
    const sender = new EmailChannelSender({ from: 'output@example.com', transporter });

    await sender.send(input({ message: { subject: 'S from template', body: 'B from template\n' } }));

    const sent = calls[0] as { subject: string; text: string; html?: unknown };
    expect(sent.subject).toBe('S from template');
    expect(sent.text).toBe('B from template\n');
    expect(sent.html).toBeUndefined();
  });

  it('GAP-10: refuses a job with no rendered message rather than inventing a default subject', async () => {
    const { transporter, calls } = fakeTransporter();
    const sender = new EmailChannelSender({ from: 'output@example.com', transporter });

    await expect(sender.send(input({ message: undefined }))).rejects.toThrow(/no rendered message/);
    expect(calls).toHaveLength(0);
  });

  it('rejects (not silently no-ops) when there are no recipients', async () => {
    const { transporter } = fakeTransporter();
    const sender = new EmailChannelSender({ from: 'output@example.com', transporter });

    await expect(sender.send(input({ recipients: [] }))).rejects.toThrow(/recipients/);
  });

  it('falls back to nodemailer jsonTransport (no injected transporter, no smtp config, no network)', async () => {
    const sender = new EmailChannelSender({ from: 'output@example.com' });
    const archiveBytes = new Uint8Array([9, 9, 9]);

    // Resolves without throwing and without any network access — proves
    // the default construction path never tries to reach a real MTA.
    await expect(sender.send(input({ archiveBytes }))).resolves.toBeUndefined();
  });
});
