import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useDevice } from '@/api/queries';
import { isApiError } from '@/api/errors';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';
import { DeviceDangerZone } from './DeviceDangerZone';
import { DeviceSettingsForm } from './DeviceSettingsForm';
import { OutageTimeline } from './OutageTimeline';

export function DevicePage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { id = '' } = useParams();
  const device = useDevice(id);

  if (device.isPending) {
    return (
      <output aria-label={t('app.common.loading')} className="flex flex-col gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24" />
      </output>
    );
  }
  if (device.isError) {
    if (isApiError(device.error, 'not_found')) {
      return (
        <div className="flex flex-col items-start gap-3">
          <h1 className="font-heading text-2xl font-semibold">{t('app.device.notFoundTitle')}</h1>
          <p className="text-muted-foreground">{t('app.device.notFoundBody')}</p>
          <Link to="/devices" className="underline">
            {t('app.device.backToList')}
          </Link>
        </div>
      );
    }
    return (
      <div role="alert" className="flex items-center gap-2 text-danger">
        <span>{errorMessage(t, device.error)}</span>
        <Button variant="outline" size="sm" onClick={() => void device.refetch()}>
          {t('app.common.retry')}
        </Button>
      </div>
    );
  }

  const { data } = device;
  const { rssi, uptime_s: uptime } = data.telemetry;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="flex flex-wrap items-center gap-2 font-heading text-2xl font-semibold">
          <span>{data.name}</span>
          <StatusBadge state={data.state} />
        </h1>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>{t('app.device.since', { moment: format.since(data.state_since) })}</span>
          <span>
            {data.last_seen_at
              ? t('app.device.lastSeen', { moment: format.moment(data.last_seen_at) })
              : t('app.device.never')}
          </span>
          {rssi === null ? null : <span>{t('app.device.rssi', { value: rssi })}</span>}
          {uptime === null ? null : (
            <span>{t('app.device.uptime', { duration: format.duration(uptime) })}</span>
          )}
        </div>
        {data.open_outage ? (
          <p className="font-medium text-status-offline">
            <span aria-hidden="true">🔴 </span>
            {t('app.device.offlineSince', { moment: format.moment(data.open_outage.started_at) })}
          </p>
        ) : null}
      </header>
      <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
        <h2 id="timeline-title" className="font-heading text-lg font-medium">
          {t('app.device.timeline')}
        </h2>
        <OutageTimeline deviceId={id} />
      </section>
      {data.role === 'OWNER' ? (
        <>
          <DeviceSettingsForm device={data} />
          <DeviceDangerZone deviceId={data.id} />
        </>
      ) : null}
    </div>
  );
}
