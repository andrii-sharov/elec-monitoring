import type { OutageItem } from '@elec/shared/api';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { OutageTags } from '@/components/OutageTags';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LiveDuration } from './OutageRow';
import { Duration, Moment } from '@/components/Moment';
import { EmptyState } from '@/components/Illustration';

const columns = ['start', 'end', 'duration', 'details'] as const;

export function HistoryTable({ outages }: { outages: OutageItem[] }) {
  const { t } = useTranslation();
  if (outages.length === 0) {
    return (
      <EmptyState illustration="historyEmpty">
        <p>{t('app.history.empty')}</p>
      </EmptyState>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-muted-foreground max-sm:sr-only">
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
                  'tabular-nums max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1.5 max-sm:p-3',
                  open && 'bg-[color-mix(in_oklab,var(--card)_92%,var(--status-offline))]',
                )}
              >
                <td className="px-3 py-2 whitespace-nowrap max-sm:p-0 max-sm:font-medium">
                  <Moment iso={outage.started_at} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap max-sm:grow max-sm:p-0 max-sm:font-medium max-sm:before:me-2 max-sm:before:text-muted-foreground max-sm:before:content-['→']">
                  {outage.ended_at ? (
                    <Moment iso={outage.ended_at} />
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-status-offline/50 text-status-offline"
                    >
                      {t('app.history.ongoing')}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap max-sm:p-0 max-sm:text-muted-foreground">
                  {outage.duration_s === null ? (
                    <LiveDuration since={outage.started_at} />
                  ) : (
                    <Duration seconds={outage.duration_s} />
                  )}
                </td>
                <td className="px-3 py-2 max-sm:p-0">
                  <OutageTags outage={outage} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
