import type { Channel } from '@elec/shared/api';
import type { DeliveryEvent } from '@elec/shared';
import type { Config } from '../config.ts';
import type { notificationChannel } from '../db/schema/index.ts';
import { decrypt } from '../lib/crypto.ts';

export type ChannelRow = typeof notificationChannel.$inferSelect;

function channelConfig(row: ChannelRow): Channel['config'] {
  if (row.type === 'WEBHOOK') {
    return { url: row.webhookUrl!, events: row.webhookEvents as DeliveryEvent[] };
  }
  return { chat_id: String(row.telegramChatId ?? '') };
}

export function toChannel(row: ChannelRow, deviceIds: string[] = []): Channel {
  return {
    id: row.id,
    type: row.type as Channel['type'],
    name: row.name,
    enabled: row.enabled,
    disabled_reason: row.disabledReason as Channel['disabled_reason'],
    config: channelConfig(row),
    created_at: row.createdAt.toISOString(),
    device_ids: deviceIds,
    failures: row.consecutiveFailures,
  };
}

export function webhookSecret(config: Pick<Config, 'encryptionKey'>, row: ChannelRow): string {
  return decrypt(config.encryptionKey, row.webhookSecretEnc!);
}
