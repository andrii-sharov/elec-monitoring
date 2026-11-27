import type { DeviceStats as Stats } from '@elec/shared/api';
import { RotateCw } from 'lucide-react';
import { lazy, Suspense, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeviceStats } from '@/api/queries';
import { EmptyState } from '@/components/Illustration';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';
import { todayIn } from '@/lib/period';
import { useNow } from '@/lib/useNow';
import { useRangeParams } from '@/lib/useRangeParams';
import { cn } from '@/lib/utils';
import { PeriodNav, PeriodSelect } from '../history/PeriodControls';
import { bucketLabels } from './bucketLabels';
import { CauseBars } from './CauseBars';
import { StatsSummary } from './StatsSummary';

const StatsChart = lazy(() => import('./StatsChart'));

const chartHeight = 'h-52 sm:h-64';

function BucketsTable({ stats }: { stats: Stats }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const labels = bucketLabels(stats.bucket, format, stats.buckets);
  return (
    <table className="sr-only">
      <caption>{t('app.stats.tableCaption')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('app.stats.columns.period')}</th>
          <th scope="col">{t('app.stats.columns.outages')}</th>
          <th scope="col">{t('app.stats.columns.downtime')}</th>
          <th scope="col">{t('app.stats.columns.availability')}</th>
          <th scope="col">{t('app.stats.columns.blips')}</th>
        </tr>
      </thead>
      <tbody>
        {stats.buckets.map((bucket) => (
          <tr key={bucket.from}>
            <th scope="row">{labels.full(bucket)}</th>
            <td>{bucket.outages}</td>
            <td>{format.duration(bucket.total_downtime_s)}</td>
            <td>
              {bucket.availability_pct === null
                ? t('app.stats.noData')
                : format.percent(bucket.availability_pct)}
            </td>
            <td>{bucket.power_blips}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatsLoading() {
  const { t } = useTranslation();
  return (
    <output aria-label={t('app.common.loading')} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_tile, index) => (
          <Skeleton key={index} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className={cn(chartHeight, 'rounded-xl')} />
    </output>
  );
}

function StatsContent({ stats }: { stats: Stats }) {
  const { t } = useTranslation();
  if (stats.monitoring_since === null) {
    return (
      <EmptyState illustration="historyEmpty">
        <p>{t('app.stats.notStarted')}</p>
      </EmptyState>
    );
  }
  return (
    <>
      <StatsSummary stats={stats} />
      <Card data-motion="enter" style={{ '--i': 5 } as CSSProperties} className="px-3 sm:px-4">
        <h3 className="text-sm font-medium">{t('app.stats.chartTitle')}</h3>
        <div aria-hidden="true">
          <Suspense fallback={<Skeleton className={cn(chartHeight, 'rounded-lg')} />}>
            <StatsChart stats={stats} />
          </Suspense>
        </div>
        <BucketsTable stats={stats} />
      </Card>
      <Card data-motion="enter" style={{ '--i': 6 } as CSSProperties} className="px-3 sm:px-4">
        <CauseBars stats={stats} />
      </Card>
    </>
  );
}

export function DeviceStats({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const now = useNow(60_000);
  const today = todayIn(now, format.timezone);
  const { range, setRange } = useRangeParams(today);
  const stats = useDeviceStats(deviceId, range, today, format.timezone);
  return (
    <div className="flex flex-col gap-3">
      <PeriodSelect range={range} today={today} onChange={setRange} />
      <PeriodNav range={range} today={today} onChange={setRange} />
      {stats.isPending ? (
        <StatsLoading />
      ) : stats.isError && !stats.data ? (
        <div role="alert" className="flex items-center gap-2 text-danger">
          <span>{errorMessage(t, stats.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void stats.refetch()}>
            <RotateCw aria-hidden="true" />
            {t('app.common.retry')}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col gap-3 transition-opacity duration-(--app-motion-duration)',
            stats.isPlaceholderData && 'opacity-60',
          )}
        >
          <StatsContent stats={stats.data} />
        </div>
      )}
    </div>
  );
}
