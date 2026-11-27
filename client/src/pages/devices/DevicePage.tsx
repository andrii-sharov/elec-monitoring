import type { Device } from '@elec/shared/api';
import { BellRing, History, RotateCw, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useDevice } from '@/api/queries';
import { isApiError } from '@/api/errors';
import { useAppStyle } from '@/appStyles/AppStyleProvider';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { useTabParam } from '@/lib/useTabParam';
import { errorMessage } from '@/forms/errorMessage';
import { DeviceChannels } from './DeviceChannels';
import { DeviceMembers } from './DeviceMembers';
import { DeviceSettingsDialog } from './DeviceSettingsDialog';
import { DeviceSetup } from './DeviceSetup';
import { DeviceHistory } from './history/DeviceHistory';
import { Illustration } from '@/components/Illustration';

export function DevicePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { data } = useDevice(id);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-11 items-center justify-between gap-2 compact:min-h-8">
        <BackLink to="/devices" label={t('app.device.backToList')} />
        {data?.role === 'OWNER' ? <DeviceSettingsDialog device={data} /> : null}
      </div>
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
          <Illustration name="notFound" className="w-44" />
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
      <div data-motion="enter">
        <DeviceHero device={data} />
      </div>
      {data.role === 'OWNER' && data.state === 'PENDING' ? (
        <SetupSection deviceId={data.id} />
      ) : null}
      <DeviceSections device={data} />
    </div>
  );
}

const sections = [
  { value: 'history', icon: History },
  { value: 'notifications', icon: BellRing },
  { value: 'members', icon: Users },
] as const;
type Section = (typeof sections)[number]['value'];

function DeviceSections({ device }: { device: Device }) {
  const { t } = useTranslation();
  const [tab, select] = useTabParam(
    sections.map((section) => section.value),
    'history',
  );
  return (
    <Tabs value={tab} onValueChange={(value) => select(value as Section)}>
      <TabsList aria-label={t('app.device.tabs.label')} className="max-sm:-mx-4 max-sm:px-4">
        {sections.map(({ value, icon: Icon }) => (
          <TabsTab key={value} value={value}>
            <Icon aria-hidden="true" />
            {t(`app.device.tabs.${value}`)}
          </TabsTab>
        ))}
      </TabsList>
      <TabsPanel value="history">
        <DeviceHistory deviceId={device.id} />
      </TabsPanel>
      <TabsPanel value="notifications">
        <DeviceChannels deviceId={device.id} />
      </TabsPanel>
      <TabsPanel value="members">
        <DeviceMembers device={device} />
      </TabsPanel>
    </Tabs>
  );
}
