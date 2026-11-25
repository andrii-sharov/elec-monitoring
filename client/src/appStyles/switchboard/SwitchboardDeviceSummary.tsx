import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StateDuration } from '@/components/StateDuration';
import type { DeviceSummaryProps } from '../slots';
import { SwitchboardStatusMark } from './SwitchboardStatusMark';

export function SwitchboardDeviceSummary({ device }: DeviceSummaryProps) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/devices/${device.id}`}
      viewTransition
      data-app-style-slot="switchboard"
      data-state={device.state}
      className="switchboard-tile flex h-full flex-col items-center justify-center gap-4 rounded-(--radius) bg-card px-3 py-6 text-center text-card-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <SwitchboardStatusMark state={device.state} lastSeenAt={device.last_seen_at} size="lg" />
      <span className="flex w-full flex-col items-center gap-1">
        <span className="w-full truncate font-heading text-sm font-medium tracking-wide uppercase">
          {device.name}
        </span>
        <StateDuration
          state={device.state}
          since={device.state_since}
          className="text-xs text-muted-foreground"
        />
        {device.role === 'VIEWER' ? (
          <span className="text-[0.65rem] text-muted-foreground uppercase">
            {t('app.devices.shared')}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
