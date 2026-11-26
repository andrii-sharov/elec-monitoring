import { DeviceTelemetry } from '@/components/DeviceTelemetry';
import { PowerStrip } from '@/components/PowerStrip';
import { StateDuration } from '@/components/StateDuration';
import type { DeviceHeroProps } from '../slots';
import { SwitchboardStatusMark } from './SwitchboardStatusMark';
import { stateStart } from '@/lib/stateStart';

export function SwitchboardDeviceHero({ device }: DeviceHeroProps) {
  return (
    <header data-app-style-slot="switchboard" className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div
          data-state={device.state}
          className="switchboard-tile flex flex-none items-center justify-center rounded-(--radius) bg-card p-4"
        >
          <SwitchboardStatusMark state={device.state} lastSeenAt={device.last_seen_at} size="lg" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate font-heading text-xl font-semibold tracking-wide uppercase sm:text-2xl">
            {device.name}
          </h1>
          <StateDuration state={device.state} since={stateStart(device)} className="text-base" />
        </div>
      </div>
      <PowerStrip deviceId={device.id} />
      <DeviceTelemetry device={device} className="sm:flex-row sm:flex-wrap sm:gap-x-4" />
    </header>
  );
}
