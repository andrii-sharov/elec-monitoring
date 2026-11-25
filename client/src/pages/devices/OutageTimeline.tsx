import type { OutageItem } from '@elec/shared/api';
import { PlugZap, RotateCw, Zap } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutages } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { useLiveDuration } from '@/components/StateDuration';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

function LiveDuration({ since }: { since: string }) {
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

function OutageRow({ outage, index }: { outage: OutageItem; index: number }) {
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
        <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
          {outage.duration_s === null ? (
            <LiveDuration since={outage.started_at} />
          ) : (
            <span>{format.duration(outage.duration_s)}</span>
          )}
          {outage.cause ? <span>{t(`app.outage.cause.${outage.cause}`)}</span> : null}
          {outage.kind ? <span>{t(`app.outage.kind.${outage.kind}`)}</span> : null}
        </span>
      </div>
    </li>
  );
}

export function OutageTimeline({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const outages = useOutages(deviceId);

  if (outages.isPending) {
    return (
      <output aria-label={t('app.common.loading')} className="flex flex-col gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </output>
    );
  }
  if (outages.isError && !outages.data) {
    return (
      <div role="alert" className="flex items-center gap-2 text-danger">
        <span>{errorMessage(t, outages.error)}</span>
        <Button variant="outline" size="sm" onClick={() => void outages.refetch()}>
          <RotateCw aria-hidden="true" />
          {t('app.common.retry')}
        </Button>
      </div>
    );
  }
  const items = outages.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return <p className="text-muted-foreground">{t('app.outage.empty')}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ol className="relative flex flex-col gap-3 pl-8 before:absolute before:top-3 before:bottom-3 before:left-[calc(0.75rem-0.5px)] before:w-px before:bg-border">
        {items.map((outage, index) => (
          <OutageRow key={outage.id} outage={outage} index={index} />
        ))}
      </ol>
      {outages.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={outages.isFetchingNextPage}
          onClick={() => void outages.fetchNextPage()}
        >
          {t('app.outage.showMore')}
        </Button>
      ) : null}
    </div>
  );
}
