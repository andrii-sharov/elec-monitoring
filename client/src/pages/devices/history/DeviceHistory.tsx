import type { OutageItem } from '@elec/shared/api';
import { Grid3x3, List, RotateCw, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useOutageRange } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';
import { createPreference } from '@/lib/preference';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import {
  containsToday,
  GRID_MAX_DAYS,
  PHONE_GRID_MAX_DAYS,
  monthChunks,
  parseRange,
  rangeParams,
  todayIn,
  type Range,
} from '@/lib/period';
import { addDays, daySummary, daysBetween, zonedTime, type Day, type LocalDate } from '@/lib/week';
import { HistoryGrid } from './HistoryGrid';
import { HistoryHeatmap } from './HistoryHeatmap';
import { HistoryTable } from './HistoryTable';
import { HistoryTimeline } from './HistoryTimeline';
import { PeriodNav, PeriodSelect } from './PeriodControls';

const views = ['timeline', 'grid', 'table'] as const;
type View = (typeof views)[number];
const viewIcons = { timeline: List, grid: Grid3x3, table: Table2 };

const viewPreference = createPreference<View>({
  key: 'em.historyView',
  choices: views,
  fallback: 'timeline',
  apply: () => {},
});

function useHistoryParams(today: LocalDate) {
  const [params, setParams] = useSearchParams();
  const [storedView, storeView] = viewPreference.use();
  const range = parseRange(params, today);
  const view = views.find((choice) => choice === params.get('view')) ?? storedView;
  const update = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  return {
    range,
    view,
    setRange: (value: Range) => update(rangeParams(value, today)),
    setView: (value: View) => {
      storeView(value);
      update({ view: value });
    },
  };
}

export function DeviceHistory({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const now = useNow(60_000);
  const today = todayIn(now, format.timezone);
  const { range, view, setRange, setView } = useHistoryParams(today);
  const days = useMemo(
    () => daysBetween(range.from, range.to, format.timezone),
    [range.from, range.to, format.timezone],
  );
  const toIso = (date: LocalDate) => new Date(zonedTime(date, 0, format.timezone)).toISOString();
  const span = { from: toIso(range.from), to: toIso(addDays(range.to, 1)) };
  const chunks = monthChunks(range).map((chunk) => ({
    from: toIso(chunk.from),
    to: toIso(addDays(chunk.to, 1)),
  }));
  const live = containsToday(range, today);
  const outages = useOutageRange(deviceId, span, live, chunks);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const showDay = (date: string) => {
    setFocusDay(date);
    setView('timeline');
  };
  const phone = useMediaQuery('(width < 40rem)');
  const long = days.length > (phone ? PHONE_GRID_MAX_DAYS : GRID_MAX_DAYS);

  return (
    <Tabs value={view} onValueChange={(value) => setView(value as View)} className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodSelect range={range} today={today} onChange={setRange} />
        <TabsList
          variant="pill"
          aria-label={t('app.history.view')}
          className="max-sm:w-full max-sm:*:grow"
        >
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
      <PeriodNav range={range} today={today} onChange={setRange} />
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
                <HistoryTimeline days={days} outages={outages.data} now={now} focusDay={focusDay} />
              ) : choice === 'grid' ? (
                long ? (
                  <HistoryHeatmap
                    days={days}
                    outages={outages.data}
                    now={now}
                    onShowDay={showDay}
                  />
                ) : (
                  <HistoryGrid days={days} outages={outages.data} now={now} onShowDay={showDay} />
                )
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
    .map((day) => daySummary(day, outages, now))
    .reduce((total, cell) => total + cell.offMs, 0);
  const count = outages.filter((outage) => outage.type === 'OUTAGE').length;
  return (
    <p className="text-sm text-muted-foreground">
      {t('app.history.summary', { outages: count, duration: format.duration(offMs / 1000) })}
    </p>
  );
}
