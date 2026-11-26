import type { OutageItem } from '@elec/shared/api';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { daySummary, type Day } from '@/lib/week';
import { GridCell } from './GridCell';

type Props = {
  days: Day[];
  outages: OutageItem[];
  now: number;
  onShowDay?: (date: string) => void;
};

export function HistoryHeatmap({ days, outages, now, onShowDay }: Props) {
  const { t } = useTranslation();
  const format = useFormatters();
  const lead = days[0]?.weekday ?? 0;
  const rows = Math.ceil((lead + days.length) / 7);
  const weekdays = Array.from({ length: 7 }, (_w, index) =>
    format.day(`2026-11-${String(23 + index).padStart(2, '0')}`, { weekday: 'narrow' }),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground sm:hidden">
        {weekdays.map((name, index) => (
          <span key={index}>{name}</span>
        ))}
      </div>
      <section
        data-grid
        aria-label={t('app.history.views.grid')}
        className="grid grid-cols-7 gap-1 sm:w-fit sm:grid-flow-col sm:grid-cols-none sm:grid-rows-7"
      >
        {Array.from({ length: lead }, (_b, index) => (
          <span key={`lead-${index}`} aria-hidden="true" />
        ))}
        {days.map((day, index) => {
          const summary = daySummary(day, outages, now);
          const date = format.day(day.date, { weekday: 'short', day: 'numeric', month: 'short' });
          const position = lead + index;
          return (
            <GridCell
              key={day.date}
              cell={summary}
              label={date}
              now={now}
              outages={outages}
              row={Math.floor(position / 7)}
              col={position % 7}
              rows={rows}
              cols={7}
              focusable={index === 0}
              fill="tint"
              className="aspect-square sm:size-3.5 sm:rounded-[3px]"
              onShowDay={onShowDay ? () => onShowDay(day.date) : undefined}
            />
          );
        })}
      </section>
    </div>
  );
}
