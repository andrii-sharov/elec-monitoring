import type { DeviceState } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { DeviceTelemetry } from '@/components/DeviceTelemetry';
import { useLiveDuration } from '@/components/StateDuration';
import type { DeviceHeroProps } from '../slots';
import { LampStatusMark } from './LampStatusMark';

const sentenceKey: Record<
  DeviceState,
  `app.lamp.${'online' | 'offline' | 'pending' | 'updating'}`
> = {
  ONLINE: 'app.lamp.online',
  OFFLINE: 'app.lamp.offline',
  PENDING: 'app.lamp.pending',
  UPDATING: 'app.lamp.updating',
};

export function LampDeviceHero({ device }: DeviceHeroProps) {
  const { t } = useTranslation();
  const duration = useLiveDuration(device.state_since);
  return (
    <header
      data-app-style-slot="lamp"
      data-state={device.state}
      className="lamp-card flex flex-col gap-5 rounded-(--radius) bg-card p-6 text-card-foreground sm:p-8"
    >
      <LampStatusMark state={device.state} lastSeenAt={device.last_seen_at} />
      <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
        {t(sentenceKey[device.state], { name: device.name, duration })}
      </h1>
      <DeviceTelemetry device={device} />
    </header>
  );
}
