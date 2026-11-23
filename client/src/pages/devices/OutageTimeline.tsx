import type { OutageItem } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { useOutages } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';

function OutageRow({ outage }: { outage: OutageItem }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const open = outage.ended_at === null;
  const blip = outage.type === 'POWER_BLIP';
  const color = open ? 'text-status-offline' : blip ? 'text-warning' : '';
  return (
    <li className={`flex flex-col gap-1 rounded-lg border p-3 ${color}`}>
      <span className="flex items-center gap-2 font-medium">
        <span aria-hidden="true">{blip ? '⚡' : '🔌'}</span>
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
  if (outages.isError) {
    return (
      <div role="alert" className="flex items-center gap-2 text-danger">
        <span>{errorMessage(t, outages.error)}</span>
        <Button variant="outline" size="sm" onClick={() => void outages.refetch()}>
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
      <ul className="flex flex-col gap-2">
        {items.map((outage) => (
          <OutageRow key={outage.id} outage={outage} />
        ))}
      </ul>
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
