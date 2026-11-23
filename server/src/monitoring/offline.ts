import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { device, outage } from '../db/schema/index.ts';
import type { Logger } from '../logger.ts';
import { offAlertDueAt } from '../notifications/rules.ts';
import type { NotificationQueue } from '../notifications/queue.ts';

export type MonitorDeps = {
  db: Db;
  clock: Clock;
  logger: Logger;
  notifications: NotificationQueue;
};

export const OFFLINE_BATCH = 100;
const MAX_BATCHES_PER_CALL = 10;

async function flipBatch(deps: MonitorDeps): Promise<{ selected: number; flipped: number }> {
  return deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    const rows = await tx
      .select()
      .from(device)
      .where(and(eq(device.state, 'ONLINE'), lte(device.offlineAt, now)))
      .orderBy(asc(device.offlineAt))
      .limit(OFFLINE_BATCH)
      .for('update', { skipLocked: true });

    let flipped = 0;
    for (const row of rows) {
      if (row.state !== 'ONLINE' || !row.offlineAt || row.offlineAt > now || !row.lastSeenAt) {
        continue;
      }
      await tx
        .update(device)
        .set({ state: 'OFFLINE', stateSince: row.offlineAt, offlineAt: null })
        .where(eq(device.id, row.id));
      await tx.insert(outage).values({
        deviceId: row.id,
        type: 'OUTAGE',
        startedAt: row.lastSeenAt,
        offAlertDueAt: offAlertDueAt(row.lastSeenAt, now, row),
        createdAt: now,
      });
      flipped += 1;
    }
    return { selected: rows.length, flipped };
  });
}

export async function checkOffline(deps: MonitorDeps): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_CALL; i++) {
    const { selected, flipped } = await flipBatch(deps);
    total += flipped;
    if (selected < OFFLINE_BATCH) break;
  }
  return total;
}

async function queueOne(deps: MonitorDeps, deviceId: string, outageId: string): Promise<boolean> {
  return deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    const [locked] = await tx
      .select({ id: device.id })
      .from(device)
      .where(eq(device.id, deviceId))
      .for('update', { skipLocked: true });
    if (!locked) return false;
    const [row] = await tx.select().from(outage).where(eq(outage.id, outageId)).for('update');
    if (
      !row ||
      row.endedAt !== null ||
      row.offAlertQueuedAt !== null ||
      !row.offAlertDueAt ||
      row.offAlertDueAt > now
    ) {
      return false;
    }
    await deps.notifications.offAlert(tx, { deviceId, outageId });
    await tx.update(outage).set({ offAlertQueuedAt: now }).where(eq(outage.id, outageId));
    return true;
  });
}

export async function queueDueOffAlerts(deps: MonitorDeps): Promise<number> {
  const now = deps.clock.now();
  const due = await deps.db
    .select({ id: outage.id, deviceId: outage.deviceId })
    .from(outage)
    .where(
      and(
        isNull(outage.endedAt),
        isNull(outage.offAlertQueuedAt),
        isNotNull(outage.offAlertDueAt),
        lte(outage.offAlertDueAt, now),
      ),
    )
    .orderBy(asc(outage.offAlertDueAt))
    .limit(OFFLINE_BATCH);

  let queued = 0;
  for (const row of due) {
    try {
      if (await queueOne(deps, row.deviceId, row.id)) queued += 1;
    } catch (err) {
      deps.logger.error('failed to queue OFF alert', row.id, err);
    }
  }
  return queued;
}
