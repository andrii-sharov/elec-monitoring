import type { OutageItem } from '@elec/shared/api';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LiveDuration } from './OutageRow';

const columns = ['start', 'end', 'duration', 'type', 'cause', 'kind'] as const;

export function HistoryTable({ outages }: { outages: OutageItem[] }) {
  const { t } = useTranslation();
  const format = useFormatters();
  if (outages.length === 0) {
    return <p className="text-muted-foreground">{t('app.history.empty')}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-xl text-sm">
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2 font-medium">
                {t(`app.history.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {outages.map((outage, index) => {
            const open = outage.ended_at === null;
            return (
              <tr
                key={outage.id}
                data-motion="enter"
                style={{ '--i': Math.min(index, 12) } as CSSProperties}
                className={cn(
                  'tabular-nums',
                  open && 'bg-[color-mix(in_oklab,var(--card)_92%,var(--status-offline))]',
                )}
              >
                <td className="px-3 py-2 whitespace-nowrap">{format.moment(outage.started_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {outage.ended_at ? (
                    format.moment(outage.ended_at)
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-status-offline/50 text-status-offline"
                    >
                      {t('app.history.ongoing')}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {outage.duration_s === null ? (
                    <LiveDuration since={outage.started_at} />
                  ) : (
                    format.duration(outage.duration_s)
                  )}
                </td>
                <td className={cn('px-3 py-2', outage.type === 'POWER_BLIP' && 'text-warning')}>
                  {t(`app.outage.type.${outage.type}`)}
                </td>
                <td className="px-3 py-2">
                  {outage.cause ? t(`app.outage.cause.${outage.cause}`) : '—'}
                </td>
                <td className="px-3 py-2">
                  {outage.kind ? t(`app.outage.kind.${outage.kind}`) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
