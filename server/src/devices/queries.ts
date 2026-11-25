import type { DeviceRole, ResetReason } from '@elec/shared';
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { device, deviceBoot, deviceViewer, outage } from '../db/schema/index.ts';
import type { DeviceRow } from './access.ts';

export type OutageRow = typeof outage.$inferSelect;

export type DeviceView = {
  device: DeviceRow;
  role: DeviceRole;
  resetReason: ResetReason | null;
  openOutage: OutageRow | null;
};

async function selectViews(db: Executor, where: SQL | undefined) {
  return db
    .select({ device, resetReason: deviceBoot.resetReason, openOutage: outage })
    .from(device)
    .leftJoin(
      deviceBoot,
      and(eq(deviceBoot.deviceId, device.id), eq(deviceBoot.bootId, device.bootId)),
    )
    .leftJoin(outage, and(eq(outage.deviceId, device.id), isNull(outage.endedAt)))
    .where(where)
    .orderBy(asc(device.createdAt), asc(device.id));
}

export async function findDeviceView(
  db: Executor,
  deviceId: string,
  role: DeviceRole,
): Promise<DeviceView | null> {
  const [row] = await selectViews(db, eq(device.id, deviceId));
  return row ? { ...row, role } : null;
}

export async function findDeviceViews(db: Executor, userId: string): Promise<DeviceView[]> {
  const rows = await selectViews(
    db,
    or(
      eq(device.ownerId, userId),
      sql`exists (select 1 from ${deviceViewer} where ${deviceViewer.deviceId} = ${device.id} and ${deviceViewer.userId} = ${userId})`,
    ),
  );
  return rows.map((row) => ({
    ...row,
    role: row.device.ownerId === userId ? ('OWNER' as const) : ('VIEWER' as const),
  }));
}
