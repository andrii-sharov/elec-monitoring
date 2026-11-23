import {
  deviceRoles,
  deviceStates,
  outageCauses,
  outageKinds,
  outageTypes,
  resetReasons,
} from '@elec/shared';
import { z } from 'zod';
import type { DeviceView, OutageRow } from '../../devices/queries.ts';

const isoDate = z.string().meta({ example: '2026-11-21T16:42:00Z' });

export const outageItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(outageTypes),
    started_at: isoDate,
    ended_at: isoDate.nullable(),
    duration_s: z.number().int().nullable(),
    cause: z.enum(outageCauses).nullable(),
    kind: z.enum(outageKinds).nullable(),
    ota_attempt_id: z.string().nullable(),
  })
  .meta({ id: 'OutageItem' });

export type OutageItem = z.infer<typeof outageItemSchema>;

export const quietHoursSchema = z.object({
  start: z.string().meta({ example: '23:00' }),
  end: z.string().meta({ example: '07:00' }),
});

export const deviceSettingsSchema = z.object({
  ping_interval_s: z.number().int(),
  offline_timeout_s: z.number().int(),
  short_outage_threshold_s: z.number().int(),
  notify_short_outages: z.boolean(),
  notify_network_outages: z.boolean(),
  quiet_hours: quietHoursSchema.nullable(),
  auto_update: z.boolean(),
});

export const deviceListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.enum(deviceRoles),
    state: z.enum(deviceStates),
    state_since: isoDate,
    last_seen_at: isoDate.nullable(),
    open_outage: outageItemSchema.nullable(),
    settings: deviceSettingsSchema,
  })
  .meta({ id: 'DeviceListItem' });

export const deviceSchema = deviceListItemSchema
  .extend({
    telemetry: z.object({
      rssi: z.number().int().nullable(),
      uptime_s: z.number().int().nullable(),
      reset_reason: z.enum(resetReasons).nullable(),
    }),
    settings_sync: z.object({
      desired_version: z.number().int(),
      applied_version: z.number().int().nullable(),
      pending: z.boolean(),
    }),
    firmware: z.object({
      version: z.string().nullable(),
      available: z.string().nullable(),
      update: z.null(),
    }),
  })
  .meta({ id: 'Device' });

export type DeviceListItem = z.infer<typeof deviceListItemSchema>;
export type Device = z.infer<typeof deviceSchema>;

function hhmm(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}

export function toOutageItem(row: OutageRow): OutageItem {
  return {
    id: row.id,
    type: row.type,
    started_at: row.startedAt.toISOString(),
    ended_at: row.endedAt?.toISOString() ?? null,
    duration_s: row.durationS,
    cause: row.cause,
    kind: row.kind,
    ota_attempt_id: row.otaAttemptId,
  };
}

export function toDeviceListItem(view: DeviceView): DeviceListItem {
  const d = view.device;
  const start = hhmm(d.quietHoursStart);
  const end = hhmm(d.quietHoursEnd);
  return {
    id: d.id,
    name: d.name,
    role: view.role,
    state: d.state,
    state_since: d.stateSince.toISOString(),
    last_seen_at: d.lastSeenAt?.toISOString() ?? null,
    open_outage: view.openOutage ? toOutageItem(view.openOutage) : null,
    settings: {
      ping_interval_s: d.pingIntervalS,
      offline_timeout_s: d.offlineTimeoutS,
      short_outage_threshold_s: d.shortOutageThresholdS,
      notify_short_outages: d.notifyShortOutages,
      notify_network_outages: d.notifyNetworkOutages,
      quiet_hours: start && end ? { start, end } : null,
      auto_update: d.autoUpdate,
    },
  };
}

export function toDevice(view: DeviceView): Device {
  const d = view.device;
  return {
    ...toDeviceListItem(view),
    telemetry: { rssi: d.rssi, uptime_s: d.uptimeS, reset_reason: view.resetReason },
    settings_sync: {
      desired_version: d.settingsVersion,
      applied_version: d.appliedSettingsVersion,
      pending: d.appliedSettingsVersion !== d.settingsVersion,
    },
    firmware: { version: d.fwVersion, available: null, update: null },
  };
}
