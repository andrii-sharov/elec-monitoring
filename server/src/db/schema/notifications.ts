import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../../lib/crypto.ts';
import { bytea, tstz } from '../types.ts';
import { appUser } from './auth.ts';
import { device } from './devices.ts';
import { outage } from './monitoring.ts';

export const notificationChannel = pgTable(
  'notification_channel',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    name: text().notNull(),
    enabled: boolean().notNull().default(true),
    disabledReason: text(),
    consecutiveFailures: integer().notNull().default(0),
    telegramChatId: bigint({ mode: 'bigint' }),
    telegramBotTokenEnc: bytea(),
    webhookUrl: text(),
    webhookEvents: text().array(),
    webhookSecretEnc: bytea(),
    createdAt: tstz().notNull().defaultNow(),
    updatedAt: tstz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      'notification_channel_type_check',
      sql`type in ('TELEGRAM_PLATFORM', 'TELEGRAM_BOT', 'WEBHOOK')`,
    ),
    check(
      'notification_channel_disabled_reason_check',
      sql`disabled_reason in ('USER', 'TOO_MANY_FAILURES')`,
    ),
    check('notification_channel_enabled_check', sql`enabled = (disabled_reason is null)`),
    check(
      'notification_channel_type_columns_check',
      sql`(type = 'TELEGRAM_PLATFORM'
          and telegram_chat_id is not null
          and num_nonnulls(telegram_bot_token_enc, webhook_url, webhook_events, webhook_secret_enc) = 0)
        or (type = 'TELEGRAM_BOT'
          and num_nonnulls(telegram_chat_id, telegram_bot_token_enc) = 2
          and num_nonnulls(webhook_url, webhook_events, webhook_secret_enc) = 0)
        or (type = 'WEBHOOK'
          and num_nonnulls(webhook_url, webhook_events, webhook_secret_enc) = 3
          and num_nonnulls(telegram_chat_id, telegram_bot_token_enc) = 0)`,
    ),
    check(
      'notification_channel_webhook_events_check',
      sql`cardinality(webhook_events) > 0
        and webhook_events <@ array['device.offline', 'device.online', 'device.power_blip']`,
    ),
    index('notification_channel_user_id_idx').on(t.userId),
    uniqueIndex('notification_channel_platform_chat_key')
      .on(t.userId, t.telegramChatId)
      .where(sql`type = 'TELEGRAM_PLATFORM'`),
    index('notification_channel_platform_chat_idx')
      .on(t.telegramChatId)
      .where(sql`type = 'TELEGRAM_PLATFORM'`),
  ],
).enableRLS();

export const deviceChannel = pgTable(
  'device_channel',
  {
    deviceId: uuid()
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    channelId: uuid()
      .notNull()
      .references(() => notificationChannel.id, { onDelete: 'cascade' }),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.channelId] }),
    index('device_channel_channel_id_idx').on(t.channelId),
  ],
).enableRLS();

export const delivery = pgTable(
  'delivery',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    outageId: uuid()
      .notNull()
      .references(() => outage.id, { onDelete: 'cascade' }),
    channelId: uuid()
      .notNull()
      .references(() => notificationChannel.id, { onDelete: 'cascade' }),
    event: text().notNull(),
    payload: jsonb().notNull(),
    status: text().notNull().default('QUEUED'),
    attempts: smallint().notNull().default(0),
    nextAttemptAt: tstz().notNull().defaultNow(),
    lastAttemptAt: tstz(),
    lastError: text(),
    sentAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    check(
      'delivery_event_check',
      sql`event in ('device.offline', 'device.online', 'device.power_blip')`,
    ),
    check('delivery_status_check', sql`status in ('QUEUED', 'SENT', 'RETRYING', 'FAILED')`),
    uniqueIndex('delivery_once_per_event').on(t.outageId, t.channelId, t.event),
    index('delivery_channel_created_idx').on(
      t.channelId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('delivery_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`status in ('QUEUED', 'RETRYING')`),
  ],
).enableRLS();
