import type { DeviceStats } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  XAxis,
  YAxis,
} from '@/components/ui/chart';
import { useFormatters } from '@/lib/format';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { bucketLabels } from './bucketLabels';

type Datum = {
  label: string;
  title: string;
  downtime: number;
  blips: number;
  outages: number;
  availability: number | null;
};

function tickInterval(kind: DeviceStats['bucket'], count: number, phone: boolean): number {
  if (!phone) return kind === 'HOUR' ? 1 : count > 16 ? 1 : 0;
  if (kind === 'HOUR') return 2;
  return count > 16 ? 4 : count > 7 ? 1 : 0;
}

export default function StatsChart({ stats }: { stats: DeviceStats }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const phone = useMediaQuery('(width < 40rem)');
  const labels = bucketLabels(stats.bucket, format, stats.buckets);
  const data: Datum[] = stats.buckets.map((bucket) => ({
    label: labels.axis(bucket),
    title: labels.full(bucket),
    downtime: bucket.total_downtime_s,
    blips: bucket.power_blips,
    outages: bucket.outages,
    availability: bucket.availability_pct,
  }));
  const maxBlips = Math.max(1, ...data.map((datum) => datum.blips));
  return (
    <ChartContainer
      config={{
        downtime: { label: t('app.stats.downtime'), color: 'var(--status-offline)' },
        blips: { label: t('app.stats.blips'), color: 'var(--warning)' },
      }}
      className="h-52 sm:h-64"
    >
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={tickInterval(stats.bucket, data.length, phone)}
          tickMargin={6}
        />
        <YAxis
          yAxisId="downtime"
          hide={phone}
          width={64}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={(value: number) => (value === 0 ? '0' : format.duration(value))}
        />
        <YAxis yAxisId="blips" hide domain={[0, maxBlips * 4]} />
        <ChartTooltip<Datum>
          render={(datum) => (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{datum.title}</span>
              <span>
                {t('app.stats.tooltip', {
                  outages: datum.outages,
                  downtime: format.duration(datum.downtime),
                })}
              </span>
              {datum.blips > 0 ? (
                <span>{t('app.stats.tooltipBlips', { count: datum.blips })}</span>
              ) : null}
              {datum.availability === null ? null : (
                <span>
                  {t('app.stats.availability')} {format.percent(datum.availability)}
                </span>
              )}
            </div>
          )}
        />
        <Bar
          yAxisId="downtime"
          dataKey="downtime"
          fill="var(--color-downtime)"
          radius={[3, 3, 0, 0]}
          maxBarSize={32}
        />
        <Bar
          yAxisId="blips"
          dataKey="blips"
          fill="var(--color-blips)"
          radius={[2, 2, 0, 0]}
          maxBarSize={6}
        />
      </BarChart>
    </ChartContainer>
  );
}
