import { z } from 'zod';
import { statsBuckets, statsPeriods } from '../enums.ts';
import { diffDays, isLocalDate } from '../time.ts';
import { isoDate } from './common.ts';

export const MAX_STATS_DAYS = 366;

const localDateSchema = z
  .string()
  .refine(isLocalDate, { params: { reason: 'invalid_date' } })
  .refine((value) => value >= '2000-01-01' && value <= '2100-12-31', {
    params: { reason: 'out_of_range' },
  })
  .meta({ example: '2026-11-23', description: 'Local date in the caller timezone' });

export const statsQuerySchema = z
  .object({
    period: z.enum(statsPeriods),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .superRefine((q, ctx) => {
    if (q.period !== 'CUSTOM') {
      if (q.to !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['to'], params: { reason: 'not_allowed' } });
      }
      return;
    }
    if (!q.from) ctx.addIssue({ code: 'custom', path: ['from'], params: { reason: 'required' } });
    if (!q.to) ctx.addIssue({ code: 'custom', path: ['to'], params: { reason: 'required' } });
    if (!q.from || !q.to) return;
    if (q.to < q.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], params: { reason: 'from_after_to' } });
    } else if (diffDays(q.from, q.to) + 1 > MAX_STATS_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], params: { reason: 'too_long' } });
    }
  });

export type StatsQuery = z.infer<typeof statsQuerySchema>;

export const statsBucketSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    outages: z.number().int(),
    power_blips: z.number().int(),
    total_downtime_s: z.number().int(),
    availability_pct: z.number().nullable(),
  })
  .meta({ id: 'StatsBucket' });

export type StatsBucket = z.infer<typeof statsBucketSchema>;

export const statsSchema = z
  .object({
    period: z.enum(statsPeriods),
    timezone: z.string().meta({ example: 'Europe/Kyiv' }),
    from: isoDate,
    to: isoDate,
    bucket: z.enum(statsBuckets),
    monitoring_since: isoDate.nullable(),
    outages: z.number().int(),
    long_outages: z.number().int(),
    open_outage: z.boolean(),
    power_blips: z.number().int(),
    by_cause: z.object({
      power: z.number().int(),
      network: z.number().int(),
      unknown: z.number().int(),
    }),
    total_downtime_s: z.number().int(),
    avg_outage_s: z.number().int().nullable(),
    longest_outage_s: z.number().int().nullable(),
    availability_pct: z.number().nullable(),
    buckets: z.array(statsBucketSchema),
  })
  .meta({ id: 'DeviceStats' });

export type DeviceStats = z.infer<typeof statsSchema>;
