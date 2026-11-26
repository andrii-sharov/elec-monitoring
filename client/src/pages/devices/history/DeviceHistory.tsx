import type { OutageItem } from '@elec/shared/api';
import { ChevronLeft, ChevronRight, Grid3x3, List, RotateCw, Table2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useOutageRange } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';
import { createPreference } from '@/lib/preference';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { addDays, hourCells, isWeekStart, weekDays, weekStart, type Day } from '@/lib/week';
import { HistoryGrid } from './HistoryGrid';
import { HistoryTable } from './HistoryTable';
import { HistoryTimeline } from './HistoryTimeline';

const views = ['timeline', 'grid', 'table'] as const;
type View = (typeof views)[number];
const viewIcons = { timeline: List, grid: Grid3x3, table: Table2 };

const viewPreference = createPreference<View>({
  key: 'em.historyView',
  choices: views,
  fallback: 'timeline',
  apply: () => {},
});

function useHistoryParams(current: string) {
  const [params, setParams] = useSearchParams();
  const [storedView, storeView] = viewPreference.use();
  const week = params.get('week');
  const monday = week && isWeekStart(week) && week < current ? week : current;
  const view = views.find((choice) => choice === params.get('view')) ?? storedView;
  const update = (key: string, value: string | null) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  return {
    monday,
    view,
    setWeek: (value: string) => update('week', value === current ? null : value),
    setView: (value: View) => {
      storeView(value);
      update('view', value);
    },
  };
}

export function DeviceHistory({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const now = useNow(60_000);
  const current = weekStart(now, format.timezone);
  const { monday, view, setWeek, setView } = useHistoryParams(current);
  const days = useMemo(() => weekDays(monday, format.timezone), [monday, format.timezone]);
  const range = {
    from: new Date(days[0]?.start ?? now).toISOString(),
    to: new Date(days[6]?.end ?? now).toISOString(),
  };
  const live = monday === current;
  const outages = useOutageRange(deviceId, range, live);

  return (
    <Tabs value={view} onValueChange={(value) => setView(value as View)} className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('app.history.previous')}
            onClick={() => setWeek(addDays(monday, -7))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span
            aria-live="polite"
            className="min-w-36 text-center text-sm font-medium tabular-nums"
          >
            {format.days(monday, addDays(monday, 6))}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('app.history.next')}
            disabled={live}
            onClick={() => setWeek(addDays(monday, 7))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {live ? null : (
            <Button variant="ghost" size="sm" onClick={() => setWeek(current)}>
              {t('app.history.current')}
            </Button>
          )}
        </div>
        <TabsList variant="pill" aria-label={t('app.history.view')}>
          {views.map((choice) => {
            const Icon = viewIcons[choice];
            return (
              <TabsTab key={choice} value={choice}>
                <Icon aria-hidden="true" />
                {t(`app.history.views.${choice}`)}
              </TabsTab>
            );
          })}
        </TabsList>
      </div>
      {outages.isPending ? (
        <output aria-label={t('app.common.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </output>
      ) : outages.isError && !outages.data ? (
        <div role="alert" className="flex items-center gap-2 text-danger">
          <span>{errorMessage(t, outages.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void outages.refetch()}>
            <RotateCw aria-hidden="true" />
            {t('app.common.retry')}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col gap-3 transition-opacity duration-(--app-motion-duration)',
            outages.isPlaceholderData && 'opacity-60',
          )}
        >
          <Summary days={days} outages={outages.data} now={now} />
          {views.map((choice) => (
            <TabsPanel key={choice} value={choice}>
              {choice === 'timeline' ? (
                <HistoryTimeline days={days} outages={outages.data} now={now} />
              ) : choice === 'grid' ? (
                <HistoryGrid days={days} outages={outages.data} now={now} />
              ) : (
                <HistoryTable outages={outages.data} />
              )}
            </TabsPanel>
          ))}
        </div>
      )}
    </Tabs>
  );
}

function Summary({ days, outages, now }: { days: Day[]; outages: OutageItem[]; now: number }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const offMs = days
    .flatMap((day) => hourCells(day, outages, now))
    .reduce((total, cell) => total + cell.offMs, 0);
  const count = outages.filter((outage) => outage.type === 'OUTAGE').length;
  return (
    <p className="text-sm text-muted-foreground">
      {t('app.history.summary', { outages: count, duration: format.duration(offMs / 1000) })}
    </p>
  );
}
