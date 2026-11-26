import type { OutageItem } from '@elec/shared/api';
import { ZapOff } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
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
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table
          aria-label={t('app.history.views.grid')}
          className="w-full min-w-176 border-separate border-spacing-0 text-xs"
        >
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium text-muted-foreground"
              >
                {t('app.history.day')}
              </th>
              {hours.map((hour) => (
                <th
                  key={hour}
                  scope="col"
                  className="px-0.5 py-1.5 text-center font-normal text-muted-foreground tabular-nums"
                >
                  {hour}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day, index) => {
              const weekday = format.day(day.date, { weekday: 'short', day: 'numeric' });
              return (
                <tr key={day.date} data-motion="enter" style={{ '--i': index } as CSSProperties}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-2 text-left font-medium whitespace-nowrap capitalize"
                  >
                    {weekday}
                  </th>
                  {hourCells(day, outages, now).map((cell, hour) => (
                    <td key={hours[hour]} className="p-0.5">
                      <GridCell
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
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
