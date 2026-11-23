import type { settingsPatchSchema } from '@elec/shared/api';
import type { z } from 'zod';
import type { device } from '../db/schema/index.ts';
import type { ErrorDetail } from '../http/errors.ts';
import { offlineDeadline } from '../monitoring/rules.ts';
import type { DeviceRow } from './access.ts';

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

type DeviceChanges = Partial<typeof device.$inferInsert>;

export function applySettingsPatch(
  current: DeviceRow,
  patch: SettingsPatch,
): { changes: DeviceChanges } | { error: ErrorDetail } {
  const pingIntervalS = patch.ping_interval_s ?? current.pingIntervalS;
  const offlineTimeoutS = patch.offline_timeout_s ?? current.offlineTimeoutS;
  if (offlineTimeoutS < 2 * pingIntervalS) {
    return {
      error: { path: 'settings.offline_timeout_s', code: 'too_small', min: 2 * pingIntervalS },
    };
  }

  const changes: DeviceChanges = {};
  if (patch.ping_interval_s !== undefined) changes.pingIntervalS = patch.ping_interval_s;
  if (patch.offline_timeout_s !== undefined) changes.offlineTimeoutS = patch.offline_timeout_s;
  if (patch.short_outage_threshold_s !== undefined) {
    changes.shortOutageThresholdS = patch.short_outage_threshold_s;
  }
  if (patch.notify_short_outages !== undefined) {
    changes.notifyShortOutages = patch.notify_short_outages;
  }
  if (patch.notify_network_outages !== undefined) {
    changes.notifyNetworkOutages = patch.notify_network_outages;
  }
  if (patch.auto_update !== undefined) changes.autoUpdate = patch.auto_update;
  if (patch.quiet_hours !== undefined) {
    changes.quietHoursStart = patch.quiet_hours?.start ?? null;
    changes.quietHoursEnd = patch.quiet_hours?.end ?? null;
  }

  let previousPingIntervalS = current.previousPingIntervalS;
  if (pingIntervalS !== current.pingIntervalS) {
    previousPingIntervalS = Math.max(previousPingIntervalS ?? 0, current.pingIntervalS);
    changes.previousPingIntervalS = previousPingIntervalS;
    changes.settingsVersion = current.settingsVersion + 1;
  }

  if (current.state === 'ONLINE' && current.lastSeenAt) {
    changes.offlineAt = offlineDeadline(current.lastSeenAt, {
      offlineTimeoutS,
      previousPingIntervalS,
    });
  }
  return { changes };
}
