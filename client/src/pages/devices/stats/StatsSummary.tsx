import type { DeviceStats } from '@elec/shared/api';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

type TileProps = {
  index: number;
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
  className?: string;
  children?: ReactNode;
};

function Tile({ index, label, value, hint, muted, className, children }: TileProps) {
  return (
    <Card
      size="sm"
      data-stat
      data-motion="enter"
      style={{ '--i': index } as CSSProperties}
      className={cn('min-w-0 gap-1 px-3', className)}
    >
      <span data-stat-label className="truncate text-xs text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'font-heading text-2xl leading-tight font-semibold tabular-nums',
          muted && 'text-base font-medium text-muted-foreground',
        )}
      >
        {value}
      </span>
      {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
      {children}
    </Card>
  );
}

function AvailabilityMeter({ value }: { value: number }) {
  return (
    <span
      aria-hidden="true"
      className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-status-offline/70"
    >
      <span className="h-full rounded-full bg-status-online" style={{ width: `${value}%` }} />
    </span>
  );
}

export function StatsSummary({ stats }: { stats: DeviceStats }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const none = t('app.stats.none');
  const availability = stats.availability_pct;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <Tile
        index={0}
        label={t('app.stats.availability')}
        value={availability === null ? t('app.stats.noData') : format.percent(availability)}
        muted={availability === null}
      >
        {availability === null ? null : <AvailabilityMeter value={availability} />}
      </Tile>
      <Tile
        index={1}
        label={t('app.stats.downtime')}
        value={format.duration(stats.total_downtime_s)}
        hint={
          stats.network_downtime_s > 0
            ? t('app.stats.noInternet', { duration: format.duration(stats.network_downtime_s) })
            : undefined
        }
      />
      <Tile
        index={2}
        label={t('app.stats.outages')}
        value={String(stats.outages)}
        hint={t('app.stats.longOutages', { count: stats.long_outages })}
      />
      <Tile
        index={3}
        label={t('app.stats.average')}
        value={stats.avg_outage_s === null ? none : format.duration(stats.avg_outage_s)}
        hint={
          stats.longest_outage_s === null
            ? undefined
            : t('app.stats.longest', { duration: format.duration(stats.longest_outage_s) })
        }
      />
      <Tile
        index={4}
        label={t('app.stats.blips')}
        value={String(stats.power_blips)}
        className="max-sm:col-span-2"
      />
    </div>
  );
}
