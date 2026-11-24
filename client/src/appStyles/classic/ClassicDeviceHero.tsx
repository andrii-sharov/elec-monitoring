import { PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DeviceTelemetry } from '@/components/DeviceTelemetry';
import { useFormatters } from '@/lib/format';
import { ClassicStatusMark } from './ClassicStatusMark';
import type { DeviceHeroProps } from '../slots';

export function ClassicDeviceHero({ device }: DeviceHeroProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <header data-app-style-slot="classic" className="flex flex-col gap-2">
      <h1 className="flex flex-wrap items-center gap-2 font-heading text-2xl font-semibold">
        <span>{device.name}</span>
        <ClassicStatusMark state={device.state} />
      </h1>
      <DeviceTelemetry device={device} />
      {device.open_outage ? (
        <p className="flex items-center gap-1.5 font-medium text-status-offline">
          <PlugZap aria-hidden="true" className="size-4" />
          {t('app.device.offlineSince', { moment: format.moment(device.open_outage.started_at) })}
        </p>
      ) : null}
    </header>
  );
}
