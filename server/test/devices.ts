import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.ts';
import { device, outage } from '../src/db/schema/index.ts';
import { hashDeviceToken, newDeviceToken } from '../src/devices/credentials.ts';

export type DeviceRow = typeof device.$inferSelect;

export async function createDevice(
  db: Db,
  ownerId: string,
  overrides: Partial<typeof device.$inferInsert> = {},
): Promise<DeviceRow> {
  const [row] = await db
    .insert(device)
    .values({ ownerId, name: 'Home', ...overrides })
    .returning();
  return row!;
}

export async function pairDevice(
  db: Db,
  ownerId: string,
  overrides: Partial<typeof device.$inferInsert> = {},
): Promise<{ device: DeviceRow; token: string }> {
  const token = newDeviceToken();
  const row = await createDevice(db, ownerId, {
    tokenHash: hashDeviceToken(token),
    claimedAt: new Date('2026-11-21T16:00:00Z'),
    ...overrides,
  });
  return { device: row, token };
}

export async function markOffline(
  db: Db,
  deviceId: string,
  options: { offAlertQueuedAt?: Date } = {},
): Promise<string> {
  const [row] = await db.select().from(device).where(eq(device.id, deviceId));
  if (!row?.lastSeenAt) throw new Error('markOffline needs a device that has checked in');
  const offlineSince = new Date(row.lastSeenAt.getTime() + row.offlineTimeoutS * 1000);
  await db
    .update(device)
    .set({ state: 'OFFLINE', offlineAt: null, stateSince: offlineSince })
    .where(eq(device.id, deviceId));
  const [open] = await db
    .insert(outage)
    .values({
      deviceId,
      type: 'OUTAGE',
      startedAt: row.lastSeenAt,
      offAlertDueAt: offlineSince,
      offAlertQueuedAt: options.offAlertQueuedAt ?? null,
    })
    .returning({ id: outage.id });
  return open!.id;
}

export function pingBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'PING',
    boot_id: 'b738bb72-4172-4edd-8b30-8d5219d8f5f3',
    seq: 2,
    uptime_s: 60,
    reset_reason: 'POWER_ON',
    rssi: -61,
    fw: '2.0.0',
    ...overrides,
  };
}
