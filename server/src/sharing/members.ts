import type { DeviceRole } from '@elec/shared';
import type { Member } from '@elec/shared/api';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client.ts';
import {
  appUser,
  device,
  deviceChannel,
  deviceViewer,
  notificationChannel,
} from '../db/schema/index.ts';

export async function attachUserChannels(tx: Tx, userId: string, deviceId: string): Promise<void> {
  const channels = await tx
    .select({ id: notificationChannel.id })
    .from(notificationChannel)
    .where(eq(notificationChannel.userId, userId));
  if (channels.length === 0) return;
  await tx
    .insert(deviceChannel)
    .values(channels.map((c) => ({ deviceId, channelId: c.id })))
    .onConflictDoNothing();
}

export async function joinAsViewer(tx: Tx, deviceId: string, userId: string): Promise<void> {
  await tx.insert(deviceViewer).values({ deviceId, userId }).onConflictDoNothing();
  await attachUserChannels(tx, userId, deviceId);
}

export async function listMembers(
  db: Executor,
  deviceId: string,
  caller: { id: string; role: DeviceRole },
): Promise<Member[]> {
  const [owner] = await db
    .select({ user: appUser, joinedAt: device.createdAt })
    .from(device)
    .innerJoin(appUser, eq(appUser.id, device.ownerId))
    .where(eq(device.id, deviceId));
  const viewers = await db
    .select({ user: appUser, joinedAt: deviceViewer.createdAt })
    .from(deviceViewer)
    .innerJoin(appUser, eq(appUser.id, deviceViewer.userId))
    .where(eq(deviceViewer.deviceId, deviceId))
    .orderBy(asc(deviceViewer.createdAt), asc(deviceViewer.userId));
  const rows = [
    ...(owner ? [{ ...owner, role: 'OWNER' as const }] : []),
    ...viewers.map((v) => ({ ...v, role: 'VIEWER' as const })),
  ];
  return rows.map(({ user, joinedAt, role }) => {
    const visible = caller.role === 'OWNER' || user.id === caller.id;
    return {
      user_id: user.id,
      name: user.name,
      email: visible ? user.email : null,
      phone: visible ? user.phone : null,
      role,
      joined_at: joinedAt.toISOString(),
    };
  });
}

export async function removeMember(tx: Tx, deviceId: string, userId: string): Promise<boolean> {
  const removed = await tx
    .delete(deviceViewer)
    .where(and(eq(deviceViewer.deviceId, deviceId), eq(deviceViewer.userId, userId)))
    .returning({ userId: deviceViewer.userId });
  if (removed.length === 0) return false;
  const theirChannels = tx
    .select({ id: notificationChannel.id })
    .from(notificationChannel)
    .where(eq(notificationChannel.userId, userId));
  await tx
    .delete(deviceChannel)
    .where(
      and(eq(deviceChannel.deviceId, deviceId), inArray(deviceChannel.channelId, theirChannels)),
    );
  return true;
}
