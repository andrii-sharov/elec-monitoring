import type { DeviceRole } from '@elec/shared';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { device } from '../db/schema/index.ts';
import { HttpError } from '../http/errors.ts';

export type DeviceRow = typeof device.$inferSelect;

export type DeviceAccess = 'read' | 'manage';

export async function getAccessibleDevice(
  db: Executor,
  userId: string,
  deviceId: string,
  _need: DeviceAccess,
  options: { lock?: boolean } = {},
): Promise<{ device: DeviceRow; role: DeviceRole }> {
  const query = db
    .select()
    .from(device)
    .where(and(eq(device.id, deviceId), eq(device.ownerId, userId)));
  const [row] = options.lock ? await query.for('update') : await query;
  if (!row) throw new HttpError(404, 'not_found', 'Device not found');
  return { device: row, role: 'OWNER' };
}
