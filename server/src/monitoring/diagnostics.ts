import type { DiagnosticKind } from '@elec/shared';
import { and, eq, lt } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { deviceBoot, deviceDiagnostic } from '../db/schema/index.ts';
import type { Logger } from '../logger.ts';

export type WifiEvent = {
  id: number;
  kind: DiagnosticKind;
  start_uptime_s: number;
  end_uptime_s: number;
  reason?: number | null;
};

export type WifiReport = { evicted: number; events: WifiEvent[] };

function isValid(event: WifiEvent, uptimeS: number): boolean {
  return event.end_uptime_s >= event.start_uptime_s && event.end_uptime_s <= uptimeS;
}

export async function storeWifiReport(
  tx: Tx,
  logger: Logger,
  a: { deviceId: string; bootId: string; uptimeS: number; now: Date; report: WifiReport },
): Promise<void> {
  const boot = and(eq(deviceBoot.deviceId, a.deviceId), eq(deviceBoot.bootId, a.bootId));
  await tx
    .update(deviceBoot)
    .set({ wifiEvicted: a.report.evicted })
    .where(and(boot, lt(deviceBoot.wifiEvicted, a.report.evicted)));

  const valid = a.report.events.filter((event) => isValid(event, a.uptimeS));
  if (valid.length < a.report.events.length) {
    logger.warn(
      `device ${a.deviceId} sent ${a.report.events.length - valid.length} invalid Wi-Fi records`,
    );
  }
  if (valid.length === 0) return;

  const at = (uptime: number) => new Date(a.now.getTime() - (a.uptimeS - uptime) * 1000);
  await tx
    .insert(deviceDiagnostic)
    .values(
      valid.map((event) => ({
        deviceId: a.deviceId,
        bootId: a.bootId,
        localId: event.id,
        kind: event.kind,
        reason: event.kind === 'WIFI' ? (event.reason ?? null) : null,
        startUptimeS: event.start_uptime_s,
        endUptimeS: event.end_uptime_s,
        startedAt: at(event.start_uptime_s),
        endedAt: at(event.end_uptime_s),
        receivedAt: a.now,
      })),
    )
    .onConflictDoNothing();
}
