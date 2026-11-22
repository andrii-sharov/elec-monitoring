import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../../lib/crypto.ts';
import { tstz } from '../types.ts';
import { device } from './devices.ts';
import { diagnosticKind, outageCause, outageKind, outageType, resetReason } from './enums.ts';
import { firmwareUpdateAttempt } from './firmware.ts';

export const deviceBoot = pgTable(
  'device_boot',
  {
    deviceId: uuid()
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    bootId: uuid().notNull(),
    resetReason: resetReason().notNull(),
    wifiEvicted: integer().notNull().default(0),
    firstSeenAt: tstz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.bootId] })],
).enableRLS();

export const deviceDiagnostic = pgTable(
  'device_diagnostic',
  {
    deviceId: uuid().notNull(),
    bootId: uuid().notNull(),
    localId: integer().notNull(),
    kind: diagnosticKind().notNull(),
    reason: smallint(),
    startUptimeS: integer().notNull(),
    endUptimeS: integer().notNull(),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    receivedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.bootId, t.localId] }),
    foreignKey({
      name: 'device_diagnostic_boot_fkey',
      columns: [t.deviceId, t.bootId],
      foreignColumns: [deviceBoot.deviceId, deviceBoot.bootId],
    }).onDelete('cascade'),
    check('device_diagnostic_uptime_check', sql`end_uptime_s >= start_uptime_s`),
    check('device_diagnostic_reason_check', sql`kind = 'WIFI' or reason is null`),
    index('device_diagnostic_device_started_idx').on(t.deviceId, t.startedAt.desc().nullsFirst()),
  ],
).enableRLS();

export const outage = pgTable(
  'outage',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    deviceId: uuid()
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    type: outageType().notNull(),
    startedAt: tstz().notNull(),
    endedAt: tstz(),
    durationS: integer().generatedAlwaysAs(sql`extract(epoch from ended_at - started_at)::integer`),
    cause: outageCause(),
    kind: outageKind(),
    otaAttemptId: uuid().references(() => firmwareUpdateAttempt.id, { onDelete: 'set null' }),
    offAlertDueAt: tstz(),
    offAlertQueuedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    check('outage_ended_check', sql`ended_at is null or ended_at >= started_at`),
    check(
      'outage_closed_fields_check',
      sql`(ended_at is null) = (cause is null) and (ended_at is null) = (kind is null)`,
    ),
    check(
      'outage_power_blip_check',
      sql`type = 'OUTAGE' or (ended_at is not null and off_alert_due_at is null)`,
    ),
    index('outage_device_started_idx').on(
      t.deviceId,
      t.startedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    uniqueIndex('outage_one_open_per_device')
      .on(t.deviceId)
      .where(sql`ended_at is null`),
    index('outage_off_alert_due_idx')
      .on(t.offAlertDueAt)
      .where(sql`ended_at is null and off_alert_queued_at is null`),
    index('outage_ota_attempt_id_idx')
      .on(t.otaAttemptId)
      .where(sql`ota_attempt_id is not null`),
  ],
).enableRLS();
