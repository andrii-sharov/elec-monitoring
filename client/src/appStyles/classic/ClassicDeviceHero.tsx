import { useTranslation } from 'react-i18next';
import { StatusBadge } from '@/components/StatusBadge';
import { useFormatters } from '@/lib/format';
import type { DeviceHeroProps } from '../slots';

export function ClassicDeviceHero({ device }: DeviceHeroProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { rssi, uptime_s: uptime } = device.telemetry;
  return (
    <header data-app-style-slot="classic" className="flex flex-col gap-2">
      <h1 className="flex flex-wrap items-center gap-2 font-heading text-2xl font-semibold">
        <span>{device.name}</span>
        <StatusBadge state={device.state} />
      </h1>
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
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
      {device.open_outage ? (
        <p className="font-medium text-status-offline">
          <span aria-hidden="true">🔴 </span>
          {t('app.device.offlineSince', { moment: format.moment(device.open_outage.started_at) })}
        </p>
      ) : null}
    </header>
  );
}
