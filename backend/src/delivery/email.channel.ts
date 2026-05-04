import nodemailer, { type Transporter } from 'nodemailer';
import type { AppLogger } from '../shared/logger.js';

export interface EmailChannelOptions {
  smtpUrl?: string | undefined;
  from: string;
  logger: AppLogger;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Without a user directory, the userId doubles as the address when it looks
 * like one; otherwise a deterministic placeholder keeps the channel usable.
 */
export function emailForUser(userId: string): string {
  return userId.includes('@') ? userId : `${userId}@notifications.local`;
}

export class EmailChannel {
  readonly #transport: Transporter;
  readonly #from: string;
  readonly #logger: AppLogger;
  readonly #configured: boolean;

  constructor(opts: EmailChannelOptions) {
    this.#from = opts.from;
    this.#logger = opts.logger;
    this.#configured = Boolean(opts.smtpUrl);
    this.#transport = opts.smtpUrl
      ? nodemailer.createTransport(opts.smtpUrl)
      : nodemailer.createTransport({ jsonTransport: true });
  }

  get configured(): boolean {
    return this.#configured;
  }

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const info = await this.#transport.sendMail({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });

    if (!this.#configured) {
      this.#logger.debug({ to: message.to }, 'SMTP not configured; email written to JSON transport');
    }

    return { messageId: info.messageId ?? 'json-transport' };
  }

  close(): void {
    this.#transport.close();
  }
}
