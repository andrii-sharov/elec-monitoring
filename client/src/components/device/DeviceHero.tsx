import type { Device } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { DeviceTelemetry } from '@/components/DeviceTelemetry';
import { PowerStrip } from '@/components/PowerStrip';
import { PowerCard } from './PowerCard';
import { StatusMark } from './StatusMark';

export function DeviceHero({ device }: { device: Device }) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-heading text-2xl font-bold break-words sm:text-3xl">{device.name}</h1>
        <StatusMark state={device.state} lastSeenAt={device.last_seen_at} />
        {device.role === 'VIEWER' ? (
          <Badge variant="secondary">{t('app.devices.shared')}</Badge>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PowerCard device={device} />
        <div className="flex flex-col gap-4 rounded-xl bg-card p-5 text-card-foreground shadow-(--app-surface-shadow) ring-1 ring-(--app-surface-ring) sm:p-6">
          {device.state === 'PENDING' ? null : <PowerStrip deviceId={device.id} />}
          <DeviceTelemetry device={device} />
        </div>
      </div>
    </header>
  );
}
