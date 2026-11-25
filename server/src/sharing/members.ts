import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { deviceChannel, deviceViewer, notificationChannel } from '../db/schema/index.ts';

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
