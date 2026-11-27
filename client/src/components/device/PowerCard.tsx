import type { Device } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { Moment } from '@/components/Moment';
import { useLiveDuration } from '@/components/StateDuration';
import { useFormatters } from '@/lib/format';
import { stateStart } from '@/lib/stateStart';
import { useStateChange } from '@/lib/useStateChange';
import { cn } from '@/lib/utils';
import { StatusDot } from './StatusMark';

const look: Record<Device['state'], string> = {
  ONLINE: 'bg-signal text-signal-foreground',
  OFFLINE: 'bg-card text-card-foreground ring-2 ring-status-offline ring-inset',
  PENDING: 'bg-card text-card-foreground border border-dashed border-input',
  UPDATING: 'bg-card text-card-foreground border border-dashed border-input',
};

const label: Record<Device['state'], string> = {
  ONLINE: 'text-signal-foreground',
  OFFLINE: 'text-status-offline',
  PENDING: 'text-status-pending',
  UPDATING: 'text-status-pending',
};

function Headline({ device }: { device: Device }) {
  const { t } = useTranslation();
  const duration = useLiveDuration(stateStart(device));
  if (device.state === 'PENDING' || device.state === 'UPDATING') {
    return (
      <p className="font-heading text-2xl leading-tight font-bold sm:text-3xl">
        {t(`app.device.duration.${device.state === 'PENDING' ? 'pending' : 'updating'}`)}
      </p>
    );
  }
  return (
    <p className="font-heading text-4xl leading-none font-extrabold tracking-tight tabular-nums sm:text-[2.75rem]">
      {duration}
    </p>
  );
}

export function PowerCard({ device, className }: { device: Device; className?: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const changed = useStateChange(device.state, 400);
  const since = stateStart(device);
  const muted = device.state === 'ONLINE' ? 'text-signal-foreground/75' : 'text-muted-foreground';
  return (
    <section
      aria-label={t(`app.power.${device.state}`)}
      data-state={device.state}
      data-motion={changed ? 'change' : undefined}
      className={cn(
        'power-card flex flex-col justify-between gap-6 rounded-xl p-5 sm:p-6',
        look[device.state],
        className,
      )}
    >
      <p
        className={cn(
          'flex items-center gap-2 font-mono text-xs font-bold tracking-wider uppercase',
          label[device.state],
        )}
      >
        <StatusDot state={device.state} lastSeenAt={device.last_seen_at} />
        {t(`app.power.${device.state}`)}
      </p>
      <div className="flex flex-col gap-2">
        <Headline device={device} />
        {device.state === 'PENDING' ? null : (
          <p className={cn('text-sm', muted)}>
            <Moment iso={since}>{t('app.device.since', { moment: format.moment(since) })}</Moment>
            <span aria-hidden="true"> · </span>
            {device.name}
          </p>
        )}
      </div>
    </section>
  );
}
