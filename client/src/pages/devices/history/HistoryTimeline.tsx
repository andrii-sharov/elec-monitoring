import type { OutageItem } from '@elec/shared/api';
import { useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';
import { groupByDay, type Day } from '@/lib/week';
import { OutageRail, OutageRow } from './OutageRow';
import { EmptyState } from '@/components/Illustration';

type Props = {
  days: Day[];
  outages: OutageItem[];
  now: number;
  focusDay?: string | null;
  showDayChips?: boolean;
};

function scrollToDay(date: string) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById(`day-${date}`)
    ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

export function HistoryTimeline({
  days,
  outages,
  now,
  focusDay = null,
  showDayChips = true,
}: Props) {
  const { t } = useTranslation();
  const format = useFormatters();
  const groups = groupByDay(days, outages);
  const filled = days.filter((day) => groups.has(day.date)).toReversed();
  useEffect(() => {
    if (focusDay) scrollToDay(focusDay);
  }, [focusDay]);

  return (
    <div className="flex flex-col gap-4">
      {showDayChips ? (
        <nav
          aria-label={t('app.history.days')}
          className={cn(
            'gap-1',
            days.length <= 7 ? 'grid grid-cols-7' : 'flex snap-x overflow-x-auto pb-1',
          )}
        >
          {days.map((day, index) => {
            const count = groups.get(day.date)?.length ?? 0;
            const future = day.start > now;
            return (
              <button
                key={day.date}
                type="button"
                disabled={count === 0}
                onClick={() => scrollToDay(day.date)}
                data-motion="enter"
                style={{ '--i': index } as CSSProperties}
                className={cn(
                  'flex min-w-12 shrink-0 snap-start flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  count > 0
                    ? 'border-status-offline/40 bg-card hover:bg-secondary'
                    : 'border-transparent bg-secondary/50 text-muted-foreground',
                  future && 'opacity-50',
                )}
              >
                <span className="font-medium uppercase">
                  {format.day(day.date, { weekday: 'short' })}
                </span>
                <span className="font-heading text-base">
                  {format.day(day.date, { day: 'numeric' })}
                </span>
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 tabular-nums',
                    count > 0
                      ? 'bg-status-offline text-danger-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      ) : null}
      {filled.length === 0 ? (
        <EmptyState illustration="historyEmpty">
          <p>{t('app.history.empty')}</p>
        </EmptyState>
      ) : (
        filled.map((day) => (
          <section
            key={day.date}
            id={`day-${day.date}`}
            aria-labelledby={`day-${day.date}-title`}
            className="flex scroll-mt-4 flex-col gap-3"
          >
            <h3
              id={`day-${day.date}-title`}
              className="sticky top-1 z-10 w-fit rounded-full border border-border bg-card/90 px-3 py-1 font-heading text-sm font-medium text-muted-foreground backdrop-blur"
            >
              {format.day(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            <OutageRail>
              {(groups.get(day.date) ?? []).map((outage, index) => (
                <OutageRow key={outage.id} outage={outage} index={index} />
              ))}
            </OutageRail>
          </section>
        ))
      )}
    </div>
  );
}
