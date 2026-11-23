import { channelTypes } from '@elec/shared';
import { z } from 'zod';
import type { notificationChannel } from '../db/schema/index.ts';

export type ChannelRow = typeof notificationChannel.$inferSelect;

export const channelSchema = z
  .object({
    id: z.string(),
    type: z.enum(channelTypes),
    name: z.string(),
    enabled: z.boolean(),
    disabled_reason: z.enum(['USER', 'TOO_MANY_FAILURES']).nullable(),
    config: z.object({ chat_id: z.string().meta({ example: '-1001234567890' }) }),
    created_at: z.string().meta({ example: '2026-11-21T16:42:00Z' }),
  })
  .meta({ id: 'Channel' });

export type Channel = z.infer<typeof channelSchema>;

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
