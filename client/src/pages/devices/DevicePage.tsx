import { RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useDevice } from '@/api/queries';
import { isApiError } from '@/api/errors';
import { useAppStyle } from '@/appStyles/AppStyleProvider';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { DeviceChannels } from './DeviceChannels';
import { DeviceDangerZone } from './DeviceDangerZone';
import { DeviceSettingsForm } from './DeviceSettingsForm';
import { DeviceSetup } from './DeviceSetup';
import { OutageTimeline } from './OutageTimeline';

export function DevicePage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/devices" label={t('app.device.backToList')} />
      <DeviceContent />
    </div>
  );
}

function SetupSection({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="setup-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="setup-title" className="font-heading text-lg font-medium">
        {t('app.addDevice.setupTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('app.addDevice.setupBody')}</p>
      <DeviceSetup deviceId={deviceId} />
    </section>
  );
}

function DeviceContent() {
  const { t } = useTranslation();
  const { DeviceHero } = useAppStyle().slots;
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
  if (device.isError && !device.data) {
    if (isApiError(device.error, 'not_found')) {
      return (
        <div className="flex flex-col items-start gap-3">
          <h1 className="font-heading text-2xl font-semibold">{t('app.device.notFoundTitle')}</h1>
          <p className="text-muted-foreground">{t('app.device.notFoundBody')}</p>
        </div>
      );
    }
    return (
      <div role="alert" className="flex items-center gap-2 text-danger">
        <span>{errorMessage(t, device.error)}</span>
        <Button variant="outline" size="sm" onClick={() => void device.refetch()}>
          <RotateCw aria-hidden="true" />
          {t('app.common.retry')}
        </Button>
      </div>
    );
  }

  const { data } = device;
  return (
    <div className="flex flex-col gap-6">
      <DeviceHero device={data} />
      {data.role === 'OWNER' && data.state === 'PENDING' ? (
        <SetupSection deviceId={data.id} />
      ) : null}
      <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
        <h2 id="timeline-title" className="font-heading text-lg font-medium">
          {t('app.device.timeline')}
        </h2>
        <OutageTimeline deviceId={id} />
      </section>
      <DeviceChannels deviceId={id} />
      {data.role === 'OWNER' ? (
        <>
          <DeviceSettingsForm device={data} />
          <DeviceDangerZone deviceId={data.id} />
        </>
      ) : null}
    </div>
  );
}
