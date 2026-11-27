import type { Device, DeviceListItem, OutageItem } from '@elec/shared/api';
import type { DeviceView, OutageRow } from '../../devices/queries.ts';

function hhmm(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}

export function toOutageItem(row: OutageRow): OutageItem {
  return {
    id: row.id,
    type: row.type,
    started_at: row.startedAt.toISOString(),
    ended_at: row.endedAt?.toISOString() ?? null,
    duration_s: row.durationS,
    cause: row.cause,
    kind: row.kind,
    ota_attempt_id: row.otaAttemptId,
  };
}

export function toDeviceListItem(view: DeviceView): DeviceListItem {
  const d = view.device;
  const start = hhmm(d.quietHoursStart);
  const end = hhmm(d.quietHoursEnd);
  return {
    id: d.id,
    name: d.name,
    role: view.role,
    state: d.state,
    state_since: d.stateSince.toISOString(),
    last_seen_at: d.lastSeenAt?.toISOString() ?? null,
    open_outage: view.openOutage ? toOutageItem(view.openOutage) : null,
    settings: {
      ping_interval_s: d.pingIntervalS,
      offline_timeout_s: d.offlineTimeoutS,
      short_outage_threshold_s: d.shortOutageThresholdS,
      notify_short_outages: d.notifyShortOutages,
      notify_network_outages: d.notifyNetworkOutages,
      quiet_hours: start && end ? { start, end } : null,
      auto_update: d.autoUpdate,
    },
    network_pause_until: d.networkPauseUntil?.toISOString() ?? null,
  };
}

export function toDevice(view: DeviceView): Device {
  const d = view.device;
  return {
    ...toDeviceListItem(view),
    telemetry: { rssi: d.rssi, uptime_s: d.uptimeS, reset_reason: view.resetReason },
    settings_sync: {
      desired_version: d.settingsVersion,
      applied_version: d.appliedSettingsVersion,
      pending: d.appliedSettingsVersion !== d.settingsVersion,
    },
    firmware: { version: d.fwVersion, available: null, update: null },
  };
}
