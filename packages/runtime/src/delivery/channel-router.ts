/**
 * ChannelRouter: a `ChannelSender` that dispatches to a per-channel
 * `ChannelSender` by `input.channel` (channels: email + object-store).
 * Wherever `DeliveryQueue.attemptDelivery`/
 * `processNext` expects a single `ChannelSender`, a `ChannelRouter` wired
 * with the concrete senders is that single argument.
 *
 * An unrecognized channel string is a hard error (throws), never a silent
 * no-op — same convention as rule-evaluation non-matches elsewhere in this
 * codebase (CLAUDE.md: "a non-match is an error ... never a silent
 * no-op").
 */
import type { ChannelSendInput, ChannelSender } from './channel-sender.js';

export type ChannelSenderMap = Record<string, ChannelSender>;

export class ChannelRouter implements ChannelSender {
  private readonly senders: ChannelSenderMap;

  constructor(senders: ChannelSenderMap) {
    this.senders = senders;
  }

  async send(input: ChannelSendInput): Promise<void> {
    const sender = this.senders[input.channel];
    if (sender === undefined) {
      throw new Error(
        `ChannelRouter: no ChannelSender registered for channel "${input.channel}" (docId "${input.docId}"). ` +
          `Known channels: ${Object.keys(this.senders).join(', ') || '(none)'}.`,
      );
    }
    await sender.send(input);
  }
}
