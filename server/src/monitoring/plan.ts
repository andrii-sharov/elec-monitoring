import type { DeviceState, OutageCause, OutageKind, ResetReason } from '@elec/shared';
import { classifyCause, classifyKind, isDuplicate, isPowerReset } from './rules.ts';

export type DeviceSnapshot = {
  state: DeviceState;
  stateSince: Date;
  lastSeenAt: Date | null;
  offlineAt: Date | null;
  bootId: string | null;
  seq: number | null;
  shortOutageThresholdS: number;
  networkPauseUntil: Date | null;
};

export type OpenOutage = { id: string; startedAt: Date; offAlertQueuedAt: Date | null };

export type CheckInFacts = { bootId: string; seq: number; resetReason: ResetReason };

export type CheckInEvent =
  | {
      type: 'CLOSE_OUTAGE';
      outageId: string;
      cause: OutageCause;
      kind: OutageKind;
      notify: 'RECOVERY' | 'SUMMARY';
    }
  | { type: 'LATE_OUTAGE'; startedAt: Date; cause: OutageCause; kind: OutageKind }
  | { type: 'POWER_BLIP'; startedAt: Date; kind: OutageKind }
  | { type: 'DISCARD_OUTAGE'; outageId: string };

export type CheckInPlan =
  | { action: 'DUPLICATE' }
  | { action: 'ACCEPT'; state: DeviceState; stateSince: Date; event: CheckInEvent | null };

function gapStart(start: Date, now: Date): Date {
  return start.getTime() > now.getTime() ? now : start;
}

function insidePause(device: DeviceSnapshot, startedAt: Date, now: Date): boolean {
  const until = device.networkPauseUntil;
  return until !== null && startedAt < until && now <= until;
}

function planOnline(device: DeviceSnapshot, checkIn: CheckInFacts, now: Date): CheckInPlan {
  const unchanged = { action: 'ACCEPT', state: 'ONLINE', stateSince: device.stateSince } as const;
  if (!device.lastSeenAt) return { ...unchanged, event: null };
  const startedAt = gapStart(device.lastSeenAt, now);
  const kind = classifyKind(startedAt, now, device.shortOutageThresholdS);
  const cause = classifyCause({ previousBootId: device.bootId, ...checkIn });

  if (device.offlineAt && now.getTime() >= device.offlineAt.getTime()) {
    if (cause === 'NETWORK' && insidePause(device, startedAt, now)) {
      return { ...unchanged, event: null };
    }
    return {
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: now,
      event: { type: 'LATE_OUTAGE', startedAt, cause, kind },
    };
  }
  const newBoot = device.bootId !== null && device.bootId !== checkIn.bootId;
  if (newBoot && isPowerReset(checkIn.resetReason)) {
    return { ...unchanged, event: { type: 'POWER_BLIP', startedAt, kind } };
  }
  return { ...unchanged, event: null };
}

function planOffline(
  device: DeviceSnapshot,
  open: OpenOutage | null,
  checkIn: CheckInFacts,
  now: Date,
): CheckInPlan {
  const recovered = { action: 'ACCEPT', state: 'ONLINE', stateSince: now } as const;
  if (!open) return { ...recovered, event: null };
  const cause = classifyCause({ previousBootId: device.bootId, ...checkIn });
  if (cause === 'NETWORK' && !open.offAlertQueuedAt && insidePause(device, open.startedAt, now)) {
    return { ...recovered, event: { type: 'DISCARD_OUTAGE', outageId: open.id } };
  }
  return {
    ...recovered,
    event: {
      type: 'CLOSE_OUTAGE',
      outageId: open.id,
      cause,
      kind: classifyKind(gapStart(open.startedAt, now), now, device.shortOutageThresholdS),
      notify: open.offAlertQueuedAt ? 'RECOVERY' : 'SUMMARY',
    },
  };
}

export function planCheckIn(
  device: DeviceSnapshot,
  open: OpenOutage | null,
  checkIn: CheckInFacts,
  now: Date,
): CheckInPlan {
  if (isDuplicate(device, checkIn)) return { action: 'DUPLICATE' };
  switch (device.state) {
    case 'PENDING':
      return { action: 'ACCEPT', state: 'ONLINE', stateSince: now, event: null };
    case 'ONLINE':
      return planOnline(device, checkIn, now);
    case 'OFFLINE':
      return planOffline(device, open, checkIn, now);
    case 'UPDATING':
      return { action: 'ACCEPT', state: 'UPDATING', stateSince: device.stateSince, event: null };
  }
}
