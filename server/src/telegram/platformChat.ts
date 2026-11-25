import { and, eq } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Tx } from '../db/client.ts';
import { device, deviceChannel, notificationChannel } from '../db/schema/index.ts';
import { canReadDevice } from '../devices/access.ts';
import type { Chat } from './commands.ts';

const MAX_NAME = 64;

function channelName(chat: Chat): string {
  const raw =
    chat.type === 'private'
      ? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
        (chat.username ? `@${chat.username}` : '')
      : (chat.title ?? '');
  return (raw.trim() || 'Telegram').slice(0, MAX_NAME);
}

export const platformChat = (chatId: bigint) =>
  and(
    eq(notificationChannel.type, 'TELEGRAM_PLATFORM'),
    eq(notificationChannel.telegramChatId, chatId),
  );

export async function connectPlatformChat(
  tx: Tx,
  clock: Clock,
  userId: string,
  chat: Chat,
): Promise<'linked' | 'alreadyLinked'> {
  const chatId = BigInt(chat.id);
  const [existing] = await tx
    .select({ id: notificationChannel.id })
    .from(notificationChannel)
    .where(and(eq(notificationChannel.userId, userId), platformChat(chatId)));
  if (existing) return 'alreadyLinked';

  const [channel] = await tx
    .insert(notificationChannel)
    .values({
      userId,
      type: 'TELEGRAM_PLATFORM',
      name: channelName(chat),
      telegramChatId: chatId,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })
    .returning({ id: notificationChannel.id });
  const readable = await tx
    .select({ id: device.id })
    .from(device)
    .where(canReadDevice(userId, device.ownerId, device.id));
  if (readable.length > 0) {
    await tx
      .insert(deviceChannel)
      .values(readable.map((d) => ({ deviceId: d.id, channelId: channel!.id })))
      .onConflictDoNothing();
  }
  return 'linked';
}
