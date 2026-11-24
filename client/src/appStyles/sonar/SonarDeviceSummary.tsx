import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StateDuration } from '@/components/StateDuration';
import type { DeviceSummaryProps } from '../slots';
import { SonarStatusMark } from './SonarStatusMark';

export function SonarDeviceSummary({ device }: DeviceSummaryProps) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/devices/${device.id}`}
      viewTransition
      data-app-style-slot="sonar"
      data-state={device.state}
      className="sonar-row flex items-center gap-4 rounded-(--radius) bg-card px-4 py-3 text-card-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <SonarStatusMark state={device.state} lastSeenAt={device.last_seen_at} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-heading text-base font-semibold">{device.name}</span>
        {device.role === 'VIEWER' ? (
          <span className="text-xs text-muted-foreground">{t('app.devices.shared')}</span>
        ) : null}
      </span>
      <StateDuration
        state={device.state}
        since={device.state_since}
        className="text-right text-sm text-muted-foreground"
      />
    </Link>
  );
}
