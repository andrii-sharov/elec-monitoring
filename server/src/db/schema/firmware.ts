import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { newId } from '../../lib/crypto.ts';
import { bytea, tstz } from '../types.ts';
import { appUser } from './auth.ts';
import { device } from './devices.ts';
import { updateOutcome } from './enums.ts';

export const firmwareRelease = pgTable(
  'firmware_release',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    version: text().notNull().unique('firmware_release_version_key'),
    versionCode: integer().notNull().unique('firmware_release_version_code_key'),
    channel: text().notNull().default('STABLE'),
    sizeBytes: integer().notNull(),
    sha256: bytea().notNull(),
    signature: bytea().notNull(),
    imagePath: text().notNull(),
    publishedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  () => [
    check('firmware_release_channel_check', sql`channel in ('STABLE', 'BETA')`),
    check('firmware_release_size_bytes_check', sql`size_bytes > 0`),
    check('firmware_release_sha256_check', sql`octet_length(sha256) = 32`),
  ],
).enableRLS();

export const firmwareUpdateAttempt = pgTable(
  'firmware_update_attempt',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    deviceId: uuid()
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    releaseId: uuid()
      .notNull()
      .references(() => firmwareRelease.id),
    requestedBy: uuid().references(() => appUser.id, { onDelete: 'set null' }),
    status: text().notNull().default('QUEUED'),
    startBootId: uuid(),
    startedAt: tstz(),
    windowEndsAt: tstz(),
    outcome: updateOutcome(),
    runningVersion: text(),
    resultBootId: uuid(),
    finishedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    check(
      'firmware_update_attempt_status_check',
      sql`status in ('QUEUED', 'INSTALLING', 'FINISHED', 'TIMED_OUT', 'CANCELLED')`,
    ),
    check(
      'firmware_update_attempt_started_check',
      sql`status in ('QUEUED', 'CANCELLED') or (started_at is not null and window_ends_at is not null)`,
    ),
    check('firmware_update_attempt_outcome_check', sql`(outcome is null) = (finished_at is null)`),
    check(
      'firmware_update_attempt_finished_check',
      sql`status <> 'FINISHED' or outcome is not null`,
    ),
    index('firmware_update_attempt_device_idx').on(t.deviceId, t.createdAt.desc().nullsFirst()),
    uniqueIndex('firmware_update_attempt_one_active')
      .on(t.deviceId)
      .where(sql`status in ('QUEUED', 'INSTALLING')`),
    index('firmware_update_attempt_window_idx')
      .on(t.windowEndsAt)
      .where(sql`status = 'INSTALLING'`),
    index('firmware_update_attempt_release_id_idx').on(t.releaseId),
    index('firmware_update_attempt_requested_by_idx')
      .on(t.requestedBy)
      .where(sql`requested_by is not null`),
  ],
).enableRLS();
