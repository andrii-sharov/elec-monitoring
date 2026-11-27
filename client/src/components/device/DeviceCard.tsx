import type { DeviceListItem } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Moment } from '@/components/Moment';
import { liveTickMs, useLiveDuration } from '@/components/StateDuration';
import { useFormatters } from '@/lib/format';
import { stateStart } from '@/lib/stateStart';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { StatusMark } from './StatusMark';

const edge: Record<DeviceListItem['state'], string> = {
  ONLINE: 'ring-border hover:ring-status-online/50',
  OFFLINE: 'ring-status-offline/60 hover:ring-status-offline',
  PENDING: 'ring-border hover:ring-input',
  UPDATING: 'ring-border hover:ring-input',
};

function LiveDuration({ device }: { device: DeviceListItem }) {
  const { t } = useTranslation();
  const duration = useLiveDuration(stateStart(device));
  const live = device.state === 'ONLINE' || device.state === 'OFFLINE';
  return (
    <p className="font-heading text-2xl leading-tight font-bold tabular-nums">
      {live
        ? duration
        : t(`app.device.duration.${device.state === 'PENDING' ? 'pending' : 'updating'}`)}
    </p>
  );
}

export function DeviceCard({ device }: { device: DeviceListItem }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const at = new Date(useNow(liveTickMs));
  return (
    <Link
      to={`/devices/${device.id}`}
      viewTransition
      data-state={device.state}
      className={cn(
        'group flex h-full flex-col gap-4 rounded-xl bg-card p-4 text-card-foreground shadow-(--app-surface-shadow) ring-1 transition-[box-shadow,translate] duration-(--app-motion-duration) ease-(--app-motion-ease) hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:p-5',
        edge[device.state],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-base font-semibold">{device.name}</span>
          {device.role === 'VIEWER' ? (
            <Badge variant="secondary">{t('app.devices.shared')}</Badge>
          ) : null}
        </div>
        <StatusMark state={device.state} lastSeenAt={device.last_seen_at} />
      </div>
      <LiveDuration device={device} />
      <div className="mt-auto flex flex-col gap-0.5 text-sm text-muted-foreground">
        <Moment iso={stateStart(device)} className="w-fit">
          {t('app.devices.since', { moment: format.moment(stateStart(device)) })}
        </Moment>
        {device.last_seen_at ? (
          <Moment iso={device.last_seen_at} className="w-fit">
            {t('app.devices.lastSeen', { moment: format.since(device.last_seen_at, at) })}
          </Moment>
        ) : (
          <span>{t('app.devices.never')}</span>
        )}
      </div>
    </Link>
  );
}
