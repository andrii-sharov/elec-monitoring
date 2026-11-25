import type { Device } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { liveTickMs } from './StateDuration';

function liveUptime(device: Device, now: number): number | null {
  const { uptime_s: uptime } = device.telemetry;
  if (uptime === null || device.state !== 'ONLINE' || !device.last_seen_at) return uptime;
  return uptime + Math.max(0, (now - new Date(device.last_seen_at).getTime()) / 1000);
}

export function DeviceTelemetry({ device, className }: { device: Device; className?: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const now = useNow(liveTickMs);
  const at = new Date(now);
  const { rssi } = device.telemetry;
  const uptime = liveUptime(device, now);
  return (
    <div className={cn('flex flex-col gap-1 text-sm text-muted-foreground', className)}>
      <span>{t('app.device.since', { moment: format.since(device.state_since, at) })}</span>
      <span>
        {device.last_seen_at
          ? t('app.device.lastSeen', { moment: format.since(device.last_seen_at, at) })
          : t('app.device.never')}
      </span>
      {rssi === null ? null : <span>{t('app.device.rssi', { value: rssi })}</span>}
      {uptime === null ? null : (
        <span>
          {t('app.device.uptime', { duration: format.duration(uptime, { withSeconds: true }) })}
        </span>
      )}
    </div>
  );
}
