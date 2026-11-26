import { z } from 'zod';
import { channelTypes } from '../enums.ts';

export const MAX_CHANNEL_IDS = 50;
export const MAX_DEVICE_IDS = 100;

export const channelSchema = z
  .object({
    id: z.string(),
    type: z.enum(channelTypes),
    name: z.string(),
    enabled: z.boolean(),
    disabled_reason: z.enum(['USER', 'TOO_MANY_FAILURES']).nullable(),
    config: z.object({ chat_id: z.string().meta({ example: '-1001234567890' }) }),
    created_at: z.string().meta({ example: '2026-11-21T16:42:00Z' }),
    device_ids: z.array(z.uuid()),
  })
  .meta({ id: 'Channel' });

export type Channel = z.infer<typeof channelSchema>;

export const channelListSchema = z.object({ items: z.array(channelSchema) });

export const telegramLinkSchema = z.object({
  url: z.string().meta({ example: 'https://t.me/ElecBot?start=abc' }),
  group_url: z.string().meta({ example: 'https://t.me/ElecBot?startgroup=abc' }),
  expires_at: z.string().meta({ example: '2026-11-21T16:57:00Z' }),
});

export const channelIdsSchema = z.object({ channel_ids: z.array(z.uuid()) });

export const putChannelIdsSchema = z.strictObject({
  channel_ids: z.array(z.uuid()).max(MAX_CHANNEL_IDS),
});

export const channelPatchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(64).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.enabled !== undefined, {
    params: { reason: 'empty' },
  });

export const deviceIdsSchema = z.object({ device_ids: z.array(z.uuid()) });

export const putDeviceIdsSchema = z.strictObject({
  device_ids: z.array(z.uuid()).max(MAX_DEVICE_IDS),
});
