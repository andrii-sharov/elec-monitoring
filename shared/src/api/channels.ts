import { z } from 'zod';
import { channelTypes, deliveryEvents, languages } from '../enums.ts';

export const MAX_CHANNEL_IDS = 50;
export const MAX_DEVICE_IDS = 100;
export const MAX_WEBHOOKS = 10;

const channelNameSchema = z.string().trim().min(1).max(64);

const webhookUrlSchema = z.string().max(2048).meta({ example: 'https://example.com/hook' });

const webhookEventsSchema = z
  .array(z.enum(deliveryEvents))
  .min(1)
  .max(deliveryEvents.length)
  .refine((events) => new Set(events).size === events.length, {
    params: { reason: 'duplicate' },
  });

export const webhookConfigSchema = z.object({
  url: z.string().meta({ example: 'https://example.com/hook' }),
  events: z.array(z.enum(deliveryEvents)),
});

export const channelSchema = z
  .object({
    id: z.string(),
    type: z.enum(channelTypes),
    name: z.string(),
    enabled: z.boolean(),
    disabled_reason: z.enum(['USER', 'TOO_MANY_FAILURES']).nullable(),
    config: z.union([
      z.object({ chat_id: z.string().meta({ example: '-1001234567890' }) }),
      webhookConfigSchema,
    ]),
    created_at: z.string().meta({ example: '2026-11-21T16:42:00Z' }),
    device_ids: z.array(z.uuid()),
    failures: z.number().int(),
    language: z.enum(languages).nullable(),
  })
  .meta({ id: 'Channel' });

export type Channel = z.infer<typeof channelSchema>;

export const channelWithSecretSchema = channelSchema
  .extend({ secret: z.string().meta({ example: 'whsec_…' }) })
  .meta({ id: 'ChannelWithSecret' });

export type ChannelWithSecret = z.infer<typeof channelWithSecretSchema>;

export const createWebhookSchema = z.strictObject({
  type: z.literal('WEBHOOK'),
  name: channelNameSchema,
  url: webhookUrlSchema,
  events: webhookEventsSchema,
});

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
    name: channelNameSchema.optional(),
    enabled: z.boolean().optional(),
    url: webhookUrlSchema.optional(),
    events: webhookEventsSchema.optional(),
    language: z.enum(languages).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    params: { reason: 'empty' },
  });

export const deviceIdsSchema = z.object({ device_ids: z.array(z.uuid()) });

export const putDeviceIdsSchema = z.strictObject({
  device_ids: z.array(z.uuid()).max(MAX_DEVICE_IDS),
});
