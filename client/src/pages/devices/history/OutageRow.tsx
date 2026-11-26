import type { OutageItem } from '@elec/shared/api';
import { PlugZap, Zap } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { OutageTags } from '@/components/OutageTags';
import { useLiveDuration } from '@/components/StateDuration';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

export function LiveDuration({ since }: { since: string }) {
  const duration = useLiveDuration(since);
  return (
    <span className="flex items-center gap-1.5 font-medium text-status-offline">
      <span aria-hidden="true" data-motion="ambient" className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-offline opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-status-offline" />
      </span>
      {duration}
    </span>
  );
}

export function OutageRow({ outage, index }: { outage: OutageItem; index: number }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const open = outage.ended_at === null;
  const blip = outage.type === 'POWER_BLIP';
  const accent = open ? 'text-status-offline' : blip ? 'text-warning' : 'text-muted-foreground';
  const Icon = blip ? Zap : PlugZap;
  return (
    <li data-motion="enter" style={{ '--i': index } as CSSProperties} className="relative">
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-3 -left-8 flex size-6 items-center justify-center rounded-full border bg-card',
          open ? 'border-status-offline/50' : 'border-border',
          accent,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div
        className={cn(
          'flex flex-col gap-1 rounded-lg border p-3 text-card-foreground',
          open
            ? 'border-status-offline/40 bg-[color-mix(in_oklab,var(--card)_92%,var(--status-offline))]'
            : 'border-border bg-card',
        )}
      >
        <span className={cn('font-medium', open || blip ? accent : null)}>
          {t(`app.outage.type.${outage.type}`)}
        </span>
        <span>
          {outage.ended_at
            ? format.range(outage.started_at, outage.ended_at)
            : t('app.outage.ongoingSince', { moment: format.moment(outage.started_at) })}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          {outage.duration_s === null ? (
            <LiveDuration since={outage.started_at} />
          ) : (
            <span>{format.duration(outage.duration_s)}</span>
          )}
          <OutageTags outage={outage} showType={false} />
        </span>
      </div>
    </li>
  );
}

export function OutageRail({ children }: { children: React.ReactNode }) {
  return (
    <ol className="relative flex flex-col gap-3 pl-8 before:absolute before:top-3 before:bottom-3 before:left-[calc(0.75rem-0.5px)] before:w-px before:bg-border">
      {children}
    </ol>
  );
}
