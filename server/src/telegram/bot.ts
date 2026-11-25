import { formatMoment, languages, type Language } from '@elec/shared';
import { telegramPhone } from '@elec/shared/api';
import { asc, eq } from 'drizzle-orm';
import type { i18n } from 'i18next';
import { consumeOneTimeToken } from '../auth/oneTimeTokens.ts';
import { PHONE_CODE_PREFIX, claimPhoneCode, confirmContact } from '../auth/phone.ts';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { appUser, device, deviceChannel, notificationChannel } from '../db/schema/index.ts';
import { parseCommand, type TelegramUpdate } from './commands.ts';
import { connectPlatformChat, platformChat } from './platformChat.ts';
import { renderTelegramAuth } from './pushes.ts';

export type BotDeps = {
  db: Db;
  clock: Clock;
  i18n: i18n;
  botUsername: string;
  clientUrl: string;
};
export type ReplyMarkup =
  | {
      keyboard: [[{ text: string; request_contact: true }]];
      resize_keyboard: true;
      one_time_keyboard: true;
    }
  | { remove_keyboard: true };
export type BotReply = { chatId: bigint; text: string; replyMarkup?: ReplyMarkup };

type Message = NonNullable<TelegramUpdate['message']>;
type Contact = NonNullable<Message['contact']>;

const DEFAULT_LANGUAGE: Language = 'uk';

function languageFromCode(code: string | undefined): Language {
  return languages.find((l) => l === code) ?? DEFAULT_LANGUAGE;
}

async function chatOwner(db: Db, chatId: bigint) {
  const [row] = await db
    .select({ language: appUser.language, timezone: appUser.timezone })
    .from(notificationChannel)
    .innerJoin(appUser, eq(appUser.id, notificationChannel.userId))
    .where(platformChat(chatId))
    .orderBy(asc(notificationChannel.createdAt), asc(notificationChannel.id))
    .limit(1);
  return row ? { language: row.language as Language, timezone: row.timezone } : null;
}

async function removeChat(db: Db, chatId: bigint): Promise<void> {
  await db.delete(notificationChannel).where(platformChat(chatId));
}

export async function handleUpdate(
  deps: BotDeps,
  update: TelegramUpdate,
): Promise<BotReply | null> {
  const { db } = deps;
  if (update.my_chat_member) {
    const { status } = update.my_chat_member.new_chat_member;
    if (status === 'kicked' || status === 'left') {
      await removeChat(db, BigInt(update.my_chat_member.chat.id));
    }
    return null;
  }

  const message = update.message;
  if (!message) return null;
  if (message.contact) return shareContact(deps, message, message.contact);
  if (!message.text) return null;
  const command = parseCommand(message.text, deps.botUsername);
  if (!command) return null;

  const chatId = BigInt(message.chat.id);
  const owner = await chatOwner(db, chatId);
  const language = owner?.language ?? languageFromCode(message.from?.language_code);
  const say = (key: string, vars: Record<string, string> = {}): BotReply => ({
    chatId,
    text: deps.i18n.getFixedT(language)(`telegram.bot.${key}`, vars),
  });

  switch (command.name) {
    case 'start':
      if (!command.arg) return say('welcome');
      return command.arg.startsWith(PHONE_CODE_PREFIX)
        ? openPhoneCode(deps, message, command.arg.slice(PHONE_CODE_PREFIX.length), language)
        : link(deps, message, command.arg, say);
    case 'status': {
      if (!owner) return say('notLinked');
      const rows = await db
        .select({
          id: device.id,
          name: device.name,
          state: device.state,
          stateSince: device.stateSince,
        })
        .from(deviceChannel)
        .innerJoin(notificationChannel, eq(notificationChannel.id, deviceChannel.channelId))
        .innerJoin(device, eq(device.id, deviceChannel.deviceId))
        .where(platformChat(chatId))
        .orderBy(asc(device.name), asc(device.id));
      const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
      if (unique.length === 0) return say('statusEmpty');
      const t = deps.i18n.getFixedT(owner.language);
      return {
        chatId,
        text: unique
          .map((r) =>
            t(`telegram.bot.status.${r.state}`, {
              name: r.name,
              time: formatMoment(r.stateSince, owner.language, owner.timezone),
            }),
          )
          .join('\n'),
      };
    }
    case 'stop': {
      if (!owner) return say('notLinked');
      await removeChat(db, chatId);
      return say('stopped');
    }
    default:
      return say('help');
  }
}

async function openPhoneCode(
  deps: BotDeps,
  message: Message,
  token: string,
  language: Language,
): Promise<BotReply> {
  const chatId = BigInt(message.chat.id);
  const t = deps.i18n.getFixedT(language);
  if (message.chat.type !== 'private') return { chatId, text: t('telegram.auth.privateOnly') };
  if (message.from?.id !== undefined) {
    await claimPhoneCode(deps.db, deps.clock, token, BigInt(message.from.id));
  }
  return {
    chatId,
    text: t('telegram.auth.askContact'),
    replyMarkup: {
      keyboard: [[{ text: t('telegram.auth.contactButton'), request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

async function shareContact(
  deps: BotDeps,
  message: Message,
  contact: Contact,
): Promise<BotReply | null> {
  if (message.chat.type !== 'private' || message.from?.id === undefined) return null;
  const chatId = BigInt(message.chat.id);
  const outcome = await confirmContact(deps.db, deps.clock, {
    telegramUserId: BigInt(message.from.id),
    contactUserId: contact.user_id,
    phone: telegramPhone(contact.phone_number),
    chat: message.chat,
  });

  let language: Language;
  if (outcome.kind === 'mismatch') {
    const owner = await chatOwner(deps.db, chatId);
    language = owner?.language ?? languageFromCode(message.from.language_code);
  } else {
    const [user] = await deps.db
      .select({ language: appUser.language })
      .from(appUser)
      .where(eq(appUser.id, outcome.userId));
    language = languageFromCode(user?.language);
  }

  const text =
    outcome.kind === 'recovered'
      ? renderTelegramAuth(deps.i18n, 'resetLink', {
          lang: language,
          link: `${deps.clientUrl}/reset-password?token=${outcome.resetToken}`,
        })
      : deps.i18n.getFixedT(language)(`telegram.auth.${outcome.kind}`);
  return { chatId, text, replyMarkup: { remove_keyboard: true } };
}

async function link(
  deps: BotDeps,
  message: Message,
  code: string,
  say: (key: string, vars?: Record<string, string>) => BotReply,
): Promise<BotReply> {
  const outcome = await deps.db.transaction(async (tx) => {
    const consumed = await consumeOneTimeToken(tx, deps.clock, code, 'TELEGRAM_LINK');
    if (!consumed) return null;
    const [user] = await tx.select().from(appUser).where(eq(appUser.id, consumed.userId));
    const key = await connectPlatformChat(tx, deps.clock, consumed.userId, message.chat);
    return { language: user!.language as Language, key };
  });

  if (!outcome) return say('linkExpired');
  return {
    chatId: BigInt(message.chat.id),
    text: deps.i18n.getFixedT(outcome.language)(`telegram.bot.${outcome.key}`),
  };
}
