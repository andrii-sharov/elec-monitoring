import type { DeviceRole } from '@elec/shared';
import { and, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { device, deviceViewer } from '../db/schema/index.ts';
import { HttpError } from '../http/errors.ts';

export type DeviceRow = typeof device.$inferSelect;

export type DeviceAccess = 'read' | 'manage';

export function canReadDevice(
  userId: SQLWrapper | string,
  ownerId: SQLWrapper | string,
  deviceId: SQLWrapper | string,
): SQL {
  return sql`(${userId} = ${ownerId} or exists (select 1 from ${deviceViewer} where ${deviceViewer.deviceId} = ${deviceId} and ${deviceViewer.userId} = ${userId}))`;
}

export async function getAccessibleDevice(
  db: Executor,
  userId: string,
  deviceId: string,
  need: DeviceAccess,
  options: { lock?: boolean } = {},
): Promise<{ device: DeviceRow; role: DeviceRole }> {
  const query = db
    .select({ device, viewerId: deviceViewer.userId })
    .from(device)
    .leftJoin(
      deviceViewer,
      and(eq(deviceViewer.deviceId, device.id), eq(deviceViewer.userId, userId)),
    )
    .where(eq(device.id, deviceId));
  const [row] = options.lock ? await query.for('update', { of: device }) : await query;
  if (row?.device.ownerId === userId) return { device: row.device, role: 'OWNER' };
  if (!row?.viewerId) throw new HttpError(404, 'not_found', 'Device not found');
  if (need === 'manage') {
    throw new HttpError(403, 'forbidden', 'Only the device owner can do this');
  }
  return { device: row.device, role: 'VIEWER' };
}
