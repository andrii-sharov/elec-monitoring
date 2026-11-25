import type { OutageItem } from '@elec/shared/api';
import { PlugZap, RotateCw, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOutages } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

function OutageRow({ outage }: { outage: OutageItem }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const open = outage.ended_at === null;
  const blip = outage.type === 'POWER_BLIP';
  const accent = open ? 'text-status-offline' : blip ? 'text-warning' : 'text-muted-foreground';
  const Icon = blip ? Zap : PlugZap;
  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-3 -left-8 flex size-6 items-center justify-center rounded-full border border-border bg-card',
          accent,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-card-foreground">
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
            <span>{t('app.outage.ongoing')}</span>
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
        {items.map((outage) => (
          <OutageRow key={outage.id} outage={outage} />
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
