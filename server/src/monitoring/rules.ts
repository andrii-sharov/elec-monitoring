import type { OutageCause, OutageKind, ResetReason } from '@elec/shared';

export function isPowerReset(reason: ResetReason): boolean {
  return reason === 'POWER_ON' || reason === 'BROWNOUT';
}

export function classifyCause(e: {
  previousBootId: string | null;
  bootId: string;
  resetReason: ResetReason;
}): OutageCause {
  if (e.previousBootId === null) return 'UNKNOWN';
  if (e.previousBootId === e.bootId) return 'NETWORK';
  return isPowerReset(e.resetReason) ? 'POWER' : 'UNKNOWN';
}

export function classifyKind(start: Date, end: Date, shortOutageThresholdS: number): OutageKind {
  return end.getTime() - start.getTime() < shortOutageThresholdS * 1000 ? 'SHORT' : 'LONG';
}

export function offlineDeadline(
  lastSeenAt: Date,
  s: { offlineTimeoutS: number; previousPingIntervalS: number | null },
): Date {
  const allowanceS = Math.max(s.offlineTimeoutS, 2 * (s.previousPingIntervalS ?? 0));
  return new Date(lastSeenAt.getTime() + allowanceS * 1000);
}

export function isDuplicate(
  current: { bootId: string | null; seq: number | null },
  incoming: { bootId: string; seq: number },
): boolean {
  return current.bootId === incoming.bootId && current.seq !== null && incoming.seq <= current.seq;
}
