/**
 * EmailChannelSender: the "email" `ChannelSender` implementation (ROADMAP
 * Stage 3, "Channels: email + object-store only"). Uses `nodemailer` — a
 * `packages/runtime`-only dependency (CLAUDE.md: `@busy-office/output-schema`
 * stays zero-runtime-dependency; this package is not that one).
 *
 * Testing constraint (same as `S3ArchiveStore`): there is no live SMTP
 * server in this environment, and `email-channel-sender.test.ts` never
 * touches the network. The underlying transporter is injectable
 * (`options.transporter`), narrowed to `Pick<Transporter, 'sendMail'>` so a
 * minimal fake can stand in for it — mirroring `S3ClientLike`. When no
 * transporter is injected and no SMTP config is given either, this class
 * falls back to nodemailer's own built-in `jsonTransport` (real nodemailer
 * code, zero network I/O: it composes the MIME message and returns it as
 * JSON instead of sending it) rather than constructing a real SMTP
 * transporter — that keeps "new EmailChannelSender() with no args" safe by
 * default and gives tests a second, even-more-realistic option beyond a
 * hand-rolled fake if they want one.
 *
 * No payloads in logs (CLAUDE.md golden rule): this file never logs
 * `archiveBytes` or `recipients`.
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { ChannelSendInput, ChannelSender } from './channel-sender.js';

/** The subset of `Transporter` this sender actually calls — narrow on
 * purpose so a test fake only has to implement `sendMail()`. A real
 * nodemailer `Transporter` (SMTP or otherwise) satisfies this trivially. */
export type TransporterLike = Pick<Transporter, 'sendMail'>;

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
}

export interface EmailChannelSenderOptions {
  /** The From address on every sent message. */
  from: string;
  /** SMTP config to build a real transporter from. Ignored if
   * `transporter` is provided. */
  smtp?: SmtpConfig;
  /** Inject a transporter (real or fake) instead of building one from
   * `smtp` — the mechanism this sender's tests use to avoid all network
   * I/O. Takes priority over `smtp`. */
  transporter?: TransporterLike;
  /** Subject line for delivered documents. Defaults to a docId-bearing
   * subject when omitted. */
  subjectPrefix?: string;
}

export class EmailChannelSender implements ChannelSender {
  private readonly transporter: TransporterLike;
  private readonly from: string;
  private readonly subjectPrefix: string;

  constructor(options: EmailChannelSenderOptions) {
    if (typeof options.from !== 'string' || options.from.trim() === '') {
      throw new TypeError('EmailChannelSender requires a non-empty from address.');
    }
    this.from = options.from;
    this.subjectPrefix = options.subjectPrefix ?? 'Document';
    if (options.transporter !== undefined) {
      this.transporter = options.transporter;
    } else if (options.smtp !== undefined) {
      this.transporter = nodemailer.createTransport({
        host: options.smtp.host,
        port: options.smtp.port,
        secure: options.smtp.secure ?? false,
        auth: options.smtp.auth,
      });
    } else {
      // No SMTP config and no injected transporter: fall back to
      // nodemailer's own network-free test transport rather than
      // constructing something that would try to talk to a real MTA.
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
    }
  }

  async send(input: ChannelSendInput): Promise<void> {
    if (input.recipients.length === 0) {
      throw new Error(`EmailChannelSender.send: docId "${input.docId}" has no recipients.`);
    }
    await this.transporter.sendMail({
      from: this.from,
      to: input.recipients,
      subject: `${this.subjectPrefix} ${input.docId}`,
      text: `Document ${input.docId} is attached.`,
      attachments: [
        {
          filename: `${input.docId}.pdf`,
          content: Buffer.from(input.archiveBytes),
        },
      ],
    });
  }
}
