import type { Db } from '../src/db/client.ts';
import { deviceChannel, notificationChannel } from '../src/db/schema/index.ts';

export type ChannelRow = typeof notificationChannel.$inferSelect;

let nextChatId = 1_000n;

export async function createPlatformChannel(
  db: Db,
  userId: string,
  overrides: { chatId?: bigint; enabled?: boolean; name?: string } = {},
): Promise<ChannelRow> {
  const enabled = overrides.enabled ?? true;
  const [row] = await db
    .insert(notificationChannel)
    .values({
      userId,
      type: 'TELEGRAM_PLATFORM',
      name: overrides.name ?? 'Telegram',
      enabled,
      disabledReason: enabled ? null : 'USER',
      telegramChatId: overrides.chatId ?? nextChatId++,
    })
    .returning();
  return row!;
}

export async function linkChannel(db: Db, deviceId: string, channelId: string): Promise<void> {
  await db.insert(deviceChannel).values({ deviceId, channelId });
}
