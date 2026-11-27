import type { CheckInType, ResetReason } from '@elec/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { device, deviceBoot, outage } from '../db/schema/index.ts';
import type { DeviceRow } from '../devices/access.ts';
import type { AppDeps } from '../http/app.ts';
import { storeWifiReport, type WifiReport } from './diagnostics.ts';
import { planCheckIn, type CheckInEvent } from './plan.ts';
import { offlineDeadline } from './rules.ts';

export type CheckIn = {
  type: CheckInType;
  bootId: string;
  seq: number;
  uptimeS: number;
  resetReason: ResetReason;
  rssi: number;
  fw: string;
  wifi?: WifiReport;
};

export type CheckInResult = 'ACCEPTED' | 'DUPLICATE' | 'UNAUTHORIZED';

type Deps = Pick<AppDeps, 'db' | 'clock' | 'logger' | 'notifications'>;

async function persistEvent(
  deps: Deps,
  tx: Tx,
  current: DeviceRow,
  open: { startedAt: Date } | undefined,
  event: CheckInEvent,
  now: Date,
): Promise<void> {
  const deviceId = current.id;
  if (event.type === 'DISCARD_OUTAGE') {
    await tx.delete(outage).where(eq(outage.id, event.outageId));
    return;
  }
  if (event.type === 'CLOSE_OUTAGE') {
    const startedAt = open?.startedAt ?? now;
    const endedAt = startedAt.getTime() > now.getTime() ? startedAt : now;
    await tx
      .update(outage)
      .set({ endedAt, cause: event.cause, kind: event.kind })
      .where(eq(outage.id, event.outageId));
    const closed = { deviceId, outageId: event.outageId };
    if (event.notify === 'RECOVERY') await deps.notifications.recovery(tx, closed);
    else await deps.notifications.summary(tx, closed);
    return;
  }
  const [inserted] = await tx
    .insert(outage)
    .values({
      deviceId,
      type: event.type === 'POWER_BLIP' ? 'POWER_BLIP' : 'OUTAGE',
      startedAt: event.startedAt,
      endedAt: now,
      cause: event.type === 'POWER_BLIP' ? 'POWER' : event.cause,
      kind: event.kind,
      createdAt: now,
    })
    .returning({ id: outage.id });
  const outageEvent = { deviceId, outageId: inserted!.id };
  if (event.type === 'POWER_BLIP') await deps.notifications.powerBlip(tx, outageEvent);
  else await deps.notifications.summary(tx, outageEvent);
}

async function storeWifi(deps: Deps, tx: Tx, deviceId: string, checkIn: CheckIn, now: Date) {
  if (!checkIn.wifi) return;
  await storeWifiReport(tx, deps.logger, {
    deviceId,
    bootId: checkIn.bootId,
    uptimeS: checkIn.uptimeS,
    now,
    report: checkIn.wifi,
  });
}

export async function recordCheckIn(
  deps: Deps,
  deviceId: string,
  tokenHash: Buffer,
  checkIn: CheckIn,
): Promise<CheckInResult> {
  return deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    const [current] = await tx
      .select()
      .from(device)
      .where(and(eq(device.id, deviceId), eq(device.tokenHash, tokenHash)))
      .for('update');
    if (!current) return 'UNAUTHORIZED';
    const [open] = await tx
      .select()
      .from(outage)
      .where(and(eq(outage.deviceId, deviceId), isNull(outage.endedAt)))
      .for('update');

    const plan = planCheckIn(current, open ?? null, checkIn, now);
    if (plan.action === 'DUPLICATE') {
      await storeWifi(deps, tx, deviceId, checkIn, now);
      return 'DUPLICATE';
    }

    if (current.bootId !== checkIn.bootId) {
      await tx
        .insert(deviceBoot)
        .values({
          deviceId,
          bootId: checkIn.bootId,
          resetReason: checkIn.resetReason,
          firstSeenAt: now,
        })
        .onConflictDoNothing();
    }
    if (plan.event) await persistEvent(deps, tx, current, open, plan.event, now);
    await storeWifi(deps, tx, deviceId, checkIn, now);

    await tx
      .update(device)
      .set({
        state: plan.state,
        stateSince: plan.stateSince,
        lastSeenAt: now,
        offlineAt: plan.state === 'ONLINE' ? offlineDeadline(now, current) : null,
        bootId: checkIn.bootId,
        seq: checkIn.seq,
        uptimeS: checkIn.uptimeS,
        rssi: checkIn.rssi,
        fwVersion: checkIn.fw,
      })
      .where(eq(device.id, deviceId));
    return 'ACCEPTED';
  });
}
