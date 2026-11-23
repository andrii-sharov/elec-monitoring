import { and, eq, sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Tx } from '../db/client.ts';
import {
  delivery,
  device,
  deviceChannel,
  notificationChannel,
  outage,
} from '../db/schema/index.ts';
import { toOutageItem } from '../http/devices/views.ts';
import type { DeliveryPayload } from './render.ts';
import { notificationEvent, type NotificationKind } from './rules.ts';

export type OutageEvent = { deviceId: string; outageId: string };

export interface NotificationQueue {
  offAlert(tx: Tx, event: OutageEvent): Promise<void>;
  recovery(tx: Tx, event: OutageEvent): Promise<void>;
  summary(tx: Tx, event: OutageEvent): Promise<void>;
  powerBlip(tx: Tx, event: OutageEvent): Promise<void>;
}

export const noopNotificationQueue: NotificationQueue = {
  offAlert: () => Promise.resolve(),
  recovery: () => Promise.resolve(),
  summary: () => Promise.resolve(),
  powerBlip: () => Promise.resolve(),
};

async function enqueue(clock: Clock, tx: Tx, kind: NotificationKind, e: OutageEvent) {
  const [row] = await tx
    .select({ outage, device })
    .from(outage)
    .innerJoin(device, eq(device.id, outage.deviceId))
    .where(and(eq(outage.id, e.outageId), eq(outage.deviceId, e.deviceId)));
  if (!row) return;
  const event = notificationEvent(kind, row.outage, row.device);
  if (!event) return;

  const channels = await tx
    .select({ id: notificationChannel.id })
    .from(deviceChannel)
    .innerJoin(notificationChannel, eq(notificationChannel.id, deviceChannel.channelId))
    .where(
      and(
        eq(deviceChannel.deviceId, e.deviceId),
        eq(notificationChannel.enabled, true),
        eq(notificationChannel.userId, row.device.ownerId),
        sql`(${notificationChannel.type} <> 'WEBHOOK' or ${event} = any(${notificationChannel.webhookEvents}))`,
      ),
    );
  if (channels.length === 0) return;

  const payload: DeliveryPayload = {
    event,
    device: { id: row.device.id, name: row.device.name },
    outage: toOutageItem(row.outage),
  };
  const now = clock.now();
  await tx
    .insert(delivery)
    .values(
      channels.map((c) => ({
        outageId: e.outageId,
        channelId: c.id,
        event,
        payload,
        createdAt: now,
        nextAttemptAt: now,
      })),
    )
    .onConflictDoNothing();
}

export function createNotificationQueue(clock: Clock): NotificationQueue {
  return {
    offAlert: (tx, e) => enqueue(clock, tx, 'offAlert', e),
    recovery: (tx, e) => enqueue(clock, tx, 'recovery', e),
    summary: (tx, e) => enqueue(clock, tx, 'summary', e),
    powerBlip: (tx, e) => enqueue(clock, tx, 'powerBlip', e),
  };
}
