import type { DeviceStats, StatsQuery } from '@elec/shared/api';
import { and, eq, gt, isNull, lt, min, or } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { deviceBoot, outage } from '../db/schema/index.ts';
import { computeStats, rangeSlot, resolveRange } from './compute.ts';

export type StatsDevice = { id: string; shortOutageThresholdS: number };

export async function loadStats(
  db: Executor,
  input: { device: StatsDevice; query: StatsQuery; timezone: string; now: number },
): Promise<DeviceStats> {
  const { device, timezone, now } = input;
  const range = resolveRange(input.query, timezone, now);
  const slot = rangeSlot(range, timezone);
  const [rows, [first]] = await Promise.all([
    db
      .select({
        type: outage.type,
        startedAt: outage.startedAt,
        endedAt: outage.endedAt,
        cause: outage.cause,
        kind: outage.kind,
      })
      .from(outage)
      .where(
        and(
          eq(outage.deviceId, device.id),
          lt(outage.startedAt, new Date(slot.end)),
          or(isNull(outage.endedAt), gt(outage.endedAt, new Date(slot.start))),
        ),
      ),
    db
      .select({ since: min(deviceBoot.firstSeenAt) })
      .from(deviceBoot)
      .where(eq(deviceBoot.deviceId, device.id)),
  ]);
  return computeStats({
    range,
    timezone,
    now,
    monitoringSince: first?.since ? first.since.getTime() : null,
    shortOutageThresholdS: device.shortOutageThresholdS,
    outages: rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.getTime(),
      endedAt: row.endedAt ? row.endedAt.getTime() : null,
    })),
  });
}
