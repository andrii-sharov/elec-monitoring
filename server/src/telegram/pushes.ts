import type { Language } from '@elec/shared';
import type { i18n } from 'i18next';
import type { Logger } from '../logger.ts';
import type { TelegramClient } from '../notifications/telegram.ts';

export type TelegramAuthKind = 'resetLink' | 'signupAttempt' | 'invite';

type Vars = { lang: Language; link: string; inviter?: string; device?: string };

export function renderTelegramAuth(i18n: i18n, kind: TelegramAuthKind, vars: Vars): string {
  const { lang, ...values } = vars;
  return i18n.getFixedT(lang)(`telegram.auth.${kind}`, values);
}

export function sendTelegramInBackground(
  client: TelegramClient,
  logger: Logger,
  chatId: bigint,
  text: string,
): void {
  const failed = (reason: unknown) => logger.error('telegram push failed', reason);
  client.sendMessage(chatId, text, { silent: false }).then((result) => {
    if (result.type !== 'SENT') failed(result);
  }, failed);
}
