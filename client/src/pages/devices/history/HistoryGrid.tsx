import type { OutageItem } from '@elec/shared/api';
import { ZapOff } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';
import { hourCells, type Day } from '@/lib/week';
import { GridCell, onTint } from './GridCell';

type Props = {
  days: Day[];
  outages: OutageItem[];
  now: number;
  onShowDay?: (date: string) => void;
};

const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));

function Swatch({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function HistoryGrid({ days, outages, now, onShowDay }: Props) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <div className="flex flex-col gap-3">
      <section
        data-grid
        data-motion="enter"
        aria-label={t('app.history.views.grid')}
        className="grid auto-cols-[minmax(0,1fr)] grid-flow-col grid-cols-[auto] grid-rows-[auto_repeat(24,1.5rem)] gap-0.5 rounded-lg border border-border bg-card p-2 text-xs sm:grid-flow-row sm:grid-cols-[auto_repeat(24,minmax(0,1fr))] sm:grid-rows-none"
      >
        <span aria-hidden="true" />
        {hours.map((hour, index) => (
          <span
            key={hour}
            aria-hidden="true"
            className={cn(
              'flex items-center justify-end pr-1 text-muted-foreground tabular-nums sm:justify-center sm:pr-0 sm:pb-1',
              index % 3 !== 0 && 'sm:max-lg:invisible',
            )}
          >
            {hour}
          </span>
        ))}
        {days.map((day, index) => {
          const weekday = format.day(day.date, { weekday: 'short', day: 'numeric' });
          return (
            <Fragment key={day.date}>
              <span className="flex flex-col items-center justify-end pb-1 leading-tight font-medium capitalize sm:flex-row sm:justify-start sm:pr-2 sm:pb-0 sm:whitespace-nowrap">
                <span className="sm:hidden">{format.day(day.date, { weekday: 'narrow' })}</span>
                <span className="sm:hidden">{format.day(day.date, { day: 'numeric' })}</span>
                <span className="hidden sm:inline">{weekday}</span>
              </span>
              {hourCells(day, outages, now).map((cell, hour) => (
                <GridCell
                  key={hours[hour]}
                  cell={cell}
                  now={now}
                  outages={outages}
                  row={index}
                  col={hour}
                  rows={days.length}
                  cols={24}
                  focusable={index === 0 && hour === 0}
                  onShowDay={onShowDay ? () => onShowDay(day.date) : undefined}
                  label={`${weekday} ${hours[hour]}:00–${hour === 23 ? '24' : hours[hour + 1]}:00`}
                  className={cn('h-full sm:h-8', days.length === 1 && 'sm:h-14')}
                />
              ))}
            </Fragment>
          );
        })}
      </section>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Swatch className={onTint} />
          {t('app.history.legend.on')}
        </li>
        <li className="flex items-center gap-2">
          <Swatch className={onTint}>
            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-status-offline" />
          </Swatch>
          {t('app.history.legend.partial')}
        </li>
        <li className="flex items-center gap-2">
          <Swatch className="bg-status-offline">
            <ZapOff className="size-3 text-danger-foreground" />
          </Swatch>
          {t('app.history.legend.off')}
        </li>
        <li className="flex items-center gap-2">
          <Swatch>
            <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning" />
          </Swatch>
          {t('app.history.legend.blip')}
        </li>
        <li className="flex items-center gap-2">
          <Swatch className="border-dashed" />
          {t('app.history.legend.future')}
        </li>
      </ul>
    </div>
  );
}
