import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../../lib/crypto.ts';
import { bytea, tstz } from '../types.ts';
import { appUser } from './auth.ts';
import { deviceState } from './enums.ts';

export const device = pgTable(
  'device',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    ownerId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    name: text().notNull(),

    tokenHash: bytea().unique('device_token_hash_key'),
    pairingCodeHash: bytea().unique('device_pairing_code_hash_key'),
    pairingCodeExpiresAt: tstz(),
    claimedAt: tstz(),

    state: deviceState().notNull().default('PENDING'),
    stateSince: tstz().notNull().defaultNow(),
    lastSeenAt: tstz(),
    offlineAt: tstz(),
    bootId: uuid(),
    seq: integer(),
    uptimeS: integer(),
    rssi: smallint(),
    fwVersion: text(),

    pingIntervalS: integer().notNull().default(20),
    previousPingIntervalS: integer(),
    offlineTimeoutS: integer().notNull().default(40),
    shortOutageThresholdS: integer().notNull().default(180),
    notifyShortOutages: boolean().notNull().default(true),
    notifyNetworkOutages: boolean().notNull().default(true),
    quietHoursStart: time(),
    quietHoursEnd: time(),
    autoUpdate: boolean().notNull().default(false),
    settingsVersion: integer().notNull().default(1),
    appliedSettingsVersion: integer(),

    createdAt: tstz().notNull().defaultNow(),
    updatedAt: tstz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('device_name_check', sql`name <> ''`),
    check('device_token_hash_check', sql`octet_length(token_hash) = 32`),
    check('device_pairing_code_hash_check', sql`octet_length(pairing_code_hash) = 32`),
    check('device_ping_interval_check', sql`ping_interval_s >= 5`),
    check('device_offline_timeout_check', sql`offline_timeout_s >= 2 * ping_interval_s`),
    check('device_short_outage_threshold_check', sql`short_outage_threshold_s > 0`),
    check('device_quiet_hours_check', sql`(quiet_hours_start is null) = (quiet_hours_end is null)`),
    check(
      'device_pairing_code_expiry_check',
      sql`(pairing_code_hash is null) = (pairing_code_expires_at is null)`,
    ),
    check('device_online_offline_at_check', sql`(state = 'ONLINE') = (offline_at is not null)`),
    check(
      'device_applied_settings_version_check',
      sql`applied_settings_version <= settings_version`,
    ),
    index('device_owner_id_idx').on(t.ownerId),
    index('device_offline_at_idx')
      .on(t.offlineAt)
      .where(sql`state = 'ONLINE'`),
  ],
).enableRLS();

export const deviceViewer = pgTable(
  'device_viewer',
  {
    deviceId: uuid()
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.userId] }),
    index('device_viewer_user_id_idx').on(t.userId),
  ],
).enableRLS();

export const deviceInvite = pgTable(
  'device_invite',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    deviceId: uuid()
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    email: text(),
    phone: text(),
    invitedBy: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    tokenHash: bytea().notNull().unique('device_invite_token_hash_key'),
    expiresAt: tstz().notNull(),
    acceptedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    check('device_invite_email_check', sql`email = lower(email)`),
    check('device_invite_one_identifier_check', sql`num_nonnulls(email, phone) = 1`),
    check('device_invite_token_hash_check', sql`octet_length(token_hash) = 32`),
    uniqueIndex('device_invite_pending_key')
      .on(t.deviceId, t.email)
      .where(sql`accepted_at is null`),
    uniqueIndex('device_invite_pending_phone_key')
      .on(t.deviceId, t.phone)
      .where(sql`accepted_at is null`),
    index('device_invite_device_id_idx').on(t.deviceId),
    index('device_invite_invited_by_idx').on(t.invitedBy),
  ],
).enableRLS();
