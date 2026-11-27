import type { DeliveryEvent, OutageCause, OutageKind } from '@elec/shared';

export type NotificationKind = 'offAlert' | 'recovery' | 'summary' | 'powerBlip';

export type NotifyRules = { notifyShortOutages: boolean; notifyNetworkOutages: boolean };

export function notificationEvent(
  kind: NotificationKind,
  outage: { kind: OutageKind | null; cause: OutageCause | null },
  rules: NotifyRules,
): DeliveryEvent | null {
  if (kind === 'offAlert') return 'device.offline';
  if (kind === 'recovery') return 'device.online';
  if (outage.kind === 'SHORT' && !rules.notifyShortOutages) return null;
  if (kind === 'powerBlip') return 'device.power_blip';
  if (outage.cause === 'NETWORK' && !rules.notifyNetworkOutages) return null;
  return 'device.online';
}

export function offAlertDueAt(
  startedAt: Date,
  now: Date,
  s: { notifyShortOutages: boolean; shortOutageThresholdS: number; networkPauseUntil: Date | null },
): Date {
  const afterThreshold = s.notifyShortOutages
    ? now.getTime()
    : startedAt.getTime() + s.shortOutageThresholdS * 1000;
  return new Date(Math.max(now.getTime(), afterThreshold, s.networkPauseUntil?.getTime() ?? 0));
}
