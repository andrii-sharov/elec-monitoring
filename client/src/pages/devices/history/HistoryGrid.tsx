import type { OutageItem } from '@elec/shared/api';
import { ZapOff } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';
import { hourCells, type Day, type HourCell } from '@/lib/week';

type Props = { days: Day[]; outages: OutageItem[]; now: number };

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

function Cell({ cell, label, now }: { cell: HourCell; label: string; now: number }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const length = cell.end - cell.start;
  const share = length > 0 ? cell.offMs / length : 0;
  const full = share >= 0.999;
  const current = cell.start <= now && now < cell.end;
  const state = cell.future
    ? t('app.history.legend.future')
    : cell.offMs > 0
      ? t('app.history.off', { duration: format.duration(cell.offMs / 1000) })
      : t('app.history.legend.on');
  const text = [label, state, cell.blips > 0 ? t('app.history.blips', { count: cell.blips }) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <td className="p-0.5">
      <div
        title={text}
        className={cn(
          'relative flex h-8 min-w-6 items-center justify-center overflow-hidden rounded-sm border',
          cell.future
            ? 'border-dashed border-border bg-transparent'
            : 'border-border bg-[color-mix(in_oklab,var(--card)_85%,var(--status-online))]',
          current && 'ring-2 ring-primary',
        )}
      >
        {cell.offMs > 0 ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 bg-status-offline"
            style={{ height: `${Math.max(12, share * 100)}%` }}
          />
        ) : null}
        {full ? (
          <ZapOff aria-hidden="true" className="relative size-3.5 text-danger-foreground" />
        ) : null}
        {cell.blips > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning"
          />
        ) : null}
        <span className="sr-only">{text}</span>
      </div>
    </td>
  );
}

export function HistoryGrid({ days, outages, now }: Props) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-176 border-separate border-spacing-0 text-xs">
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
                    <Cell
                      key={hours[hour]}
                      cell={cell}
                      now={now}
                      label={`${weekday} ${hours[hour]}:00–${hour === 23 ? '24' : hours[hour + 1]}:00`}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Swatch className="bg-[color-mix(in_oklab,var(--card)_85%,var(--status-online))]" />
          {t('app.history.legend.on')}
        </li>
        <li className="flex items-center gap-2">
          <Swatch className="bg-[color-mix(in_oklab,var(--card)_85%,var(--status-online))]">
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
