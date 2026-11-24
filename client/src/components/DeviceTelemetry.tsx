import type { Device } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DeviceTelemetry({ device, className }: { device: Device; className?: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { rssi, uptime_s: uptime } = device.telemetry;
  return (
    <div className={cn('flex flex-col gap-1 text-sm text-muted-foreground', className)}>
      <span>{t('app.device.since', { moment: format.since(device.state_since) })}</span>
      <span>
        {device.last_seen_at
          ? t('app.device.lastSeen', { moment: format.moment(device.last_seen_at) })
          : t('app.device.never')}
      </span>
      {rssi === null ? null : <span>{t('app.device.rssi', { value: rssi })}</span>}
      {uptime === null ? null : (
        <span>{t('app.device.uptime', { duration: format.duration(uptime) })}</span>
      )}
    </div>
  );
}
