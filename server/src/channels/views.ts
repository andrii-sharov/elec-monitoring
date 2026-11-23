import type { Channel } from '@elec/shared/api';
import type { notificationChannel } from '../db/schema/index.ts';

export type ChannelRow = typeof notificationChannel.$inferSelect;

export function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    type: row.type as Channel['type'],
    name: row.name,
    enabled: row.enabled,
    disabled_reason: row.disabledReason as Channel['disabled_reason'],
    config: { chat_id: String(row.telegramChatId ?? '') },
    created_at: row.createdAt.toISOString(),
  };
}
