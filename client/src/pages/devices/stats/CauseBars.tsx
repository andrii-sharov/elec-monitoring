import type { DeviceStats } from '@elec/shared/api';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';

const causes = [
  { key: 'power', color: 'var(--status-offline)' },
  { key: 'network', color: 'var(--live)' },
  { key: 'unknown', color: 'var(--status-pending)' },
] as const;

export function CauseBars({ stats }: { stats: DeviceStats }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const closed = causes.reduce((sum, { key }) => sum + stats.by_cause[key], 0);
  return (
    <section aria-labelledby="stats-causes" className="flex flex-col gap-2">
      <h3 id="stats-causes" className="text-sm font-medium">
        {t('app.stats.causes')}
      </h3>
      {stats.outages === 0 ? (
        <p className="text-sm text-muted-foreground">{t('app.stats.noOutages')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {causes.map(({ key, color }) => {
            const count = stats.by_cause[key];
            const share = closed === 0 ? 0 : (count / closed) * 100;
            return (
              <li
                key={key}
                className="grid grid-cols-[minmax(5rem,auto)_1fr_auto] items-center gap-3 text-sm"
              >
                <span>{t(`app.stats.cause.${key}`)}</span>
                <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-secondary">
                  <span
                    className="block h-full rounded-full transition-[width] duration-(--app-motion-duration)"
                    style={{ width: `${share}%`, background: color } as CSSProperties}
                  />
                </span>
                <span className="text-right tabular-nums">
                  <span className="font-medium">{count}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    {format.percent(Math.round(share))}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {stats.open_outage ? (
        <p className="flex items-center gap-2 text-sm text-status-offline">
          <span aria-hidden="true" className="size-2 rounded-full bg-status-offline" />
          {t('app.stats.open', { count: 1 })}
        </p>
      ) : null}
    </section>
  );
}
