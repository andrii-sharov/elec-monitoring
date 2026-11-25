import type { TelegramTransportConfig } from '../config.ts';
import type { Logger } from '../logger.ts';

export type SendResult =
  | { type: 'SENT' }
  | { type: 'RETRY_AFTER'; seconds: number }
  | { type: 'MIGRATED'; chatId: bigint }
  | { type: 'PERMANENT'; error: string }
  | { type: 'TRANSIENT'; error: string };

export interface TelegramClient {
  sendMessage(chatId: bigint, text: string, opts: { silent: boolean }): Promise<SendResult>;
}

const TIMEOUT_MS = 10_000;
const MAX_ERROR_CHARS = 500;

type BotResponse = {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

export function createTelegramClient(
  botToken: string,
  fetchFn: typeof fetch = fetch,
): TelegramClient {
  const clean = (text: string) => text.replaceAll(botToken, '<token>').slice(0, MAX_ERROR_CHARS);

  return {
    async sendMessage(chatId, text, opts) {
      let response: Response;
      try {
        response = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: String(chatId),
            text,
            disable_notification: opts.silent,
            link_preview_options: { is_disabled: true },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return { type: 'TRANSIENT', error: clean(message) };
      }
      if (response.ok) return { type: 'SENT' };

      const body = (await response.json().catch(() => ({}))) as BotResponse;
      const error = clean(`HTTP ${response.status}: ${body.description ?? response.statusText}`);
      const migrated = body.parameters?.migrate_to_chat_id;
      if (migrated !== undefined) return { type: 'MIGRATED', chatId: BigInt(migrated) };
      if (response.status === 429) {
        return { type: 'RETRY_AFTER', seconds: body.parameters?.retry_after ?? 5 };
      }
      if (response.status === 400 || response.status === 403) return { type: 'PERMANENT', error };
      return { type: 'TRANSIENT', error };
    },
  };
}

export function createLogTelegramClient(logger: Logger): TelegramClient {
  return {
    sendMessage(chatId, text, opts) {
      logger.info(`telegram to ${chatId}${opts.silent ? ' (silent)' : ''}\n${text}`);
      return Promise.resolve({ type: 'SENT' });
    },
  };
}

export function createTelegramTransport(
  config: TelegramTransportConfig,
  logger: Logger,
): TelegramClient {
  return config.transport === 'log'
    ? createLogTelegramClient(logger)
    : createTelegramClient(config.botToken);
}
