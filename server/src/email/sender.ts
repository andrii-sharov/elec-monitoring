import { Resend } from 'resend';
import type { EmailConfig } from '../config.ts';
import type { Logger } from '../logger.ts';
import type { RenderedEmail } from './templates.ts';

export type EmailMessage = RenderedEmail & { to: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createResendSender(client: Pick<Resend, 'emails'>, from: string): EmailSender {
  return {
    async send({ to, subject, text, html }) {
      const { error } = await client.emails.send({ from, to, subject, text, html });
      if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
    },
  };
}

export function createLogSender(from: string, logger: Logger): EmailSender {
  return {
    send({ to, subject, text }) {
      logger.info(`email from ${from} to ${to}\nsubject: ${subject}\n${text}`);
      return Promise.resolve();
    },
  };
}

export function createEmailSender(config: EmailConfig, logger: Logger): EmailSender {
  if (config.transport === 'log') return createLogSender(config.from, logger);
  return createResendSender(new Resend(config.resendApiKey), config.from);
}

export function sendInBackground(sender: EmailSender, logger: Logger, message: EmailMessage): void {
  sender.send(message).catch((err: unknown) => {
    logger.error('failed to send email', err);
  });
}
