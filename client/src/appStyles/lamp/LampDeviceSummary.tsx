import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StateDuration } from '@/components/StateDuration';
import type { DeviceSummaryProps } from '../slots';
import { LampStatusMark } from './LampStatusMark';
import { stateStart } from '@/lib/stateStart';

export function LampDeviceSummary({ device }: DeviceSummaryProps) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/devices/${device.id}`}
      viewTransition
      data-app-style-slot="lamp"
      data-state={device.state}
      className="lamp-card flex h-full flex-col gap-4 rounded-(--lamp-card-radius) bg-card p-6 text-card-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <LampStatusMark state={device.state} lastSeenAt={device.last_seen_at} />
      <span className="flex flex-col gap-1">
        <span className="font-heading text-2xl leading-tight font-semibold tracking-tight">
          {device.name}
        </span>
        <StateDuration state={device.state} since={stateStart(device)} className="text-sm" />
        {device.role === 'VIEWER' ? (
          <span className="text-xs">{t('app.devices.shared')}</span>
        ) : null}
      </span>
    </Link>
  );
}
