import { DeviceTelemetry } from '@/components/DeviceTelemetry';
import { PowerStrip } from '@/components/PowerStrip';
import { StateDuration } from '@/components/StateDuration';
import type { DeviceHeroProps } from '../slots';
import { SonarStatusMark } from './SonarStatusMark';
import { stateStart } from '@/lib/stateStart';

export function SonarDeviceHero({ device }: DeviceHeroProps) {
  return (
    <header
      data-app-style-slot="sonar"
      data-state={device.state}
      className="sonar-hero flex flex-col gap-4 rounded-(--radius) bg-card p-5 text-card-foreground sm:p-6"
    >
      <div className="flex items-center gap-4">
        <SonarStatusMark state={device.state} lastSeenAt={device.last_seen_at} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <StateDuration
            state={device.state}
            since={stateStart(device)}
            className="sonar-headline font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
          />
          <h1 className="text-base break-words text-muted-foreground">{device.name}</h1>
        </div>
      </div>
      <PowerStrip deviceId={device.id} />
      <DeviceTelemetry device={device} />
    </header>
  );
}
