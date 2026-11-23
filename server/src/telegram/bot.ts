import { languages, type Language } from '@elec/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { i18n } from 'i18next';
import { consumeOneTimeToken } from '../auth/oneTimeTokens.ts';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { appUser, device, deviceChannel, notificationChannel } from '../db/schema/index.ts';
import { formatMoment } from '../notifications/format.ts';
import { parseCommand, type TelegramUpdate } from './commands.ts';

export type BotDeps = { db: Db; clock: Clock; i18n: i18n; botUsername: string };
export type BotReply = { chatId: bigint; text: string };

type Message = NonNullable<TelegramUpdate['message']>;
type Chat = Message['chat'];

const DEFAULT_LANGUAGE: Language = 'uk';
const MAX_NAME = 64;

function languageFromCode(code: string | undefined): Language {
  return languages.find((l) => l === code) ?? DEFAULT_LANGUAGE;
}

function channelName(chat: Chat): string {
  const raw =
    chat.type === 'private'
      ? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
        (chat.username ? `@${chat.username}` : '')
      : (chat.title ?? '');
  return (raw.trim() || 'Telegram').slice(0, MAX_NAME);
}

const platformChat = (chatId: bigint) =>
  and(
    eq(notificationChannel.type, 'TELEGRAM_PLATFORM'),
    eq(notificationChannel.telegramChatId, chatId),
  );

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
  if (!message?.text) return null;
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
      return command.arg ? link(deps, message, command.arg, say) : say('welcome');
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

async function link(
  deps: BotDeps,
  message: Message,
  code: string,
  say: (key: string, vars?: Record<string, string>) => BotReply,
): Promise<BotReply> {
  const chatId = BigInt(message.chat.id);
  const outcome = await deps.db.transaction(async (tx) => {
    const userId = await consumeOneTimeToken(tx, deps.clock, code, 'TELEGRAM_LINK');
    if (!userId) return null;
    const [user] = await tx.select().from(appUser).where(eq(appUser.id, userId));
    const [existing] = await tx
      .select({ id: notificationChannel.id })
      .from(notificationChannel)
      .where(and(eq(notificationChannel.userId, userId), platformChat(chatId)));
    if (existing) return { language: user!.language as Language, key: 'alreadyLinked' };

    const [channel] = await tx
      .insert(notificationChannel)
      .values({
        userId,
        type: 'TELEGRAM_PLATFORM',
        name: channelName(message.chat),
        telegramChatId: chatId,
        createdAt: deps.clock.now(),
        updatedAt: deps.clock.now(),
      })
      .returning({ id: notificationChannel.id });
    const owned = await tx.select({ id: device.id }).from(device).where(eq(device.ownerId, userId));
    if (owned.length > 0) {
      await tx
        .insert(deviceChannel)
        .values(owned.map((d) => ({ deviceId: d.id, channelId: channel!.id })))
        .onConflictDoNothing();
    }
    return { language: user!.language as Language, key: 'linked' };
  });

  if (!outcome) return say('linkExpired');
  return {
    chatId,
    text: deps.i18n.getFixedT(outcome.language)(`telegram.bot.${outcome.key}`),
  };
}
