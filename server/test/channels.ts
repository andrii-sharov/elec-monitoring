import type { DeliveryEvent } from '@elec/shared';
import type { Db } from '../src/db/client.ts';
import { deviceChannel, notificationChannel } from '../src/db/schema/index.ts';
import { encrypt } from '../src/lib/crypto.ts';
import { testConfig } from './app.ts';

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

export async function createWebhookChannel(
  db: Db,
  userId: string,
  overrides: { url?: string; events?: DeliveryEvent[]; secret?: string; name?: string } = {},
): Promise<ChannelRow> {
  const [row] = await db
    .insert(notificationChannel)
    .values({
      userId,
      type: 'WEBHOOK',
      name: overrides.name ?? 'Webhook',
      webhookUrl: overrides.url ?? 'https://hooks.example.com/elec',
      webhookEvents: overrides.events ?? ['device.offline'],
      webhookSecretEnc: encrypt(testConfig.encryptionKey, overrides.secret ?? 'whsec_test_secret'),
    })
    .returning();
  return row!;
}

export async function linkChannel(db: Db, deviceId: string, channelId: string): Promise<void> {
  await db.insert(deviceChannel).values({ deviceId, channelId });
}
