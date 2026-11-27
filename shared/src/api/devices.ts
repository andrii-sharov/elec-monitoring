import { z } from 'zod';
import {
  deviceRoles,
  deviceStates,
  outageCauses,
  outageKinds,
  outageTypes,
  resetReasons,
} from '../enums.ts';
import { isoDate, limitSchema, page } from './common.ts';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const deviceNameSchema = z.string().trim().min(1).max(64);

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

export const settingsPatchSchema = z.strictObject({
  ping_interval_s: z.number().int().min(5).max(600).optional(),
  offline_timeout_s: z.number().int().min(10).max(3600).optional(),
  short_outage_threshold_s: z.number().int().min(30).max(86_400).optional(),
  notify_short_outages: z.boolean().optional(),
  notify_network_outages: z.boolean().optional(),
  quiet_hours: z
    .strictObject({ start: timeOfDay, end: timeOfDay })
    .refine((q) => q.start !== q.end, { path: ['end'], params: { reason: 'same_time' } })
    .nullable()
    .optional(),
  auto_update: z.boolean().optional(),
});

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
    network_pause_until: isoDate.nullable(),
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

export const deviceListSchema = z.object({ items: z.array(deviceListItemSchema) });

export const createDeviceBodySchema = z.object({ name: deviceNameSchema });

export const NETWORK_PAUSE_MIN = 5;
export const NETWORK_PAUSE_MAX = 120;

export const networkPauseBodySchema = z.strictObject({
  minutes: z.number().int().min(NETWORK_PAUSE_MIN).max(NETWORK_PAUSE_MAX),
});

export const networkPauseSchema = z.object({ until: isoDate }).meta({ id: 'NetworkPause' });

export const devicePatchSchema = z.strictObject({
  name: deviceNameSchema.optional(),
  settings: settingsPatchSchema.optional(),
});

export const pairingCodeSchema = z.object({
  pairing_code: z.string().meta({ example: 'K7Q2M9XD' }),
  pairing_code_expires_at: z.string().meta({ example: '2026-11-21T17:12:00Z' }),
});

export const createDeviceResponseSchema = pairingCodeSchema.extend({ device: deviceSchema });

export const deviceParamsSchema = z.object({ id: z.uuid() });

export const rangeQueryFields = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: limitSchema,
  cursor: z.string().max(512).optional(),
};

export function checkRange(q: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (q.from && q.to && new Date(q.from) > new Date(q.to)) {
    ctx.addIssue({ code: 'custom', path: ['from'], params: { reason: 'from_after_to' } });
  }
}

export const outagesQuerySchema = z
  .object({
    ...rangeQueryFields,
    type: z.enum(outageTypes).optional(),
    cause: z.enum(outageCauses).optional(),
    kind: z.enum(outageKinds).optional(),
  })
  .superRefine(checkRange);

export const outagesPageSchema = page(outageItemSchema);
