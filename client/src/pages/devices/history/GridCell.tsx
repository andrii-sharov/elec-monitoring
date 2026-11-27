import type { OutageItem } from '@elec/shared/api';
import { ZapOff } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Duration, Moment, MomentRange } from '@/components/Moment';
import { OutageTags } from '@/components/OutageTags';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';
import { outagesIn, type HourCell } from '@/lib/week';

export const onTint = 'bg-[color-mix(in_oklab,var(--card)_85%,var(--status-online))]';

type GridCellProps = {
  cell: HourCell;
  label: string;
  now: number;
  outages: OutageItem[];
  row: number;
  col: number;
  rows: number;
  cols: number;
  focusable: boolean;
  onShowDay?: () => void;
  fill?: 'bar' | 'tint';
  className?: string;
};

function cellState(cell: HourCell, t: TFunction, duration: string) {
  if (cell.future) return t('app.history.legend.future');
  if (cell.offMs > 0) return t('app.history.off', { duration });
  return t('app.history.legend.on');
}

export function GridCell({
  cell,
  label,
  now,
  outages,
  row,
  col,
  rows,
  cols,
  focusable,
  onShowDay,
  fill = 'bar',
  className,
}: GridCellProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const length = cell.end - cell.start;
  const share = length > 0 ? cell.offMs / length : 0;
  const full = share >= 0.999;
  const current = cell.start <= now && now < cell.end;
  const state = cellState(cell, t, format.duration(cell.offMs / 1000));
  const text = [label, state, cell.blips > 0 ? t('app.history.blips', { count: cell.blips }) : null]
    .filter(Boolean)
    .join(' · ');
  const elapsed = Math.max(0, Math.min(now, cell.end) - cell.start);
  const touching = outagesIn(cell, outages, now);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={250}
        closeDelay={100}
        data-row={row}
        data-col={col}
        tabIndex={focusable ? 0 : -1}
        onKeyDown={(event) => gridKeyboard(event, rows, cols)}
        aria-label={text}
        className={cn(
          'relative flex w-full min-w-0 items-center justify-center overflow-hidden rounded-sm border outline-none focus-visible:ring-3 focus-visible:ring-ring/60',
          cell.future ? 'border-dashed border-border bg-transparent' : `border-border ${onTint}`,
          current && 'ring-2 ring-live',
          className,
        )}
      >
        {cell.offMs > 0 && fill === 'tint' ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-status-offline"
            style={{ opacity: 0.25 + share * 0.75 }}
          />
        ) : null}
        {cell.offMs > 0 && fill === 'bar' ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 bg-status-offline"
            style={{ height: `${Math.max(12, share * 100)}%` }}
          />
        ) : null}
        {full && fill === 'bar' ? (
          <ZapOff aria-hidden="true" className="relative size-3.5 text-danger-foreground" />
        ) : null}
        {cell.blips > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80 gap-3">
        <p className="font-heading font-medium">{label}</p>
        {cell.future ? (
          <p className="text-muted-foreground">{t('app.history.legend.future')}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t('app.history.cell.withoutPower')}
              </dt>
              <dd className="font-medium text-status-offline">
                <Duration seconds={cell.offMs / 1000} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('app.history.cell.withPower')}</dt>
              <dd className="font-medium">
                <Duration seconds={Math.max(0, elapsed - cell.offMs) / 1000} />
              </dd>
            </div>
            {cell.networkMs > 0 ? (
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t('app.history.cell.withoutInternet')}
                </dt>
                <dd className="font-medium text-muted-foreground">
                  <Duration seconds={cell.networkMs / 1000} />
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        {touching.length === 0 && !cell.future ? (
          <p className="text-muted-foreground">{t('app.history.cell.none')}</p>
        ) : null}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <ul className="flex flex-col gap-2">
            {touching.map((outage) => (
              <li
                key={outage.id}
                className="flex flex-col gap-1 rounded-md border border-border p-2"
              >
                {outage.type === 'POWER_BLIP' ? (
                  <Moment iso={outage.started_at}>
                    {t('app.history.cell.blipAt', { time: format.time(outage.started_at) })}
                  </Moment>
                ) : outage.ended_at ? (
                  <MomentRange from={outage.started_at} to={outage.ended_at} />
                ) : (
                  <Moment iso={outage.started_at}>
                    {t('app.outage.ongoingSince', { moment: format.moment(outage.started_at) })}
                  </Moment>
                )}
                <OutageTags outage={outage} />
              </li>
            ))}
          </ul>
        </div>
        {onShowDay ? (
          <button
            type="button"
            onClick={onShowDay}
            className="w-fit text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('app.history.cell.showInTimeline')}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function gridKeyboard(event: KeyboardEvent<HTMLElement>, rows: number, cols: number) {
  const target = event.target as HTMLElement;
  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  if (Number.isNaN(row) || Number.isNaN(col)) return;
  const moves: Record<string, [number, number]> = {
    ArrowUp: [row - 1, col],
    ArrowDown: [row + 1, col],
    ArrowLeft: [row, col - 1],
    ArrowRight: [row, col + 1],
    Home: [row, 0],
    End: [row, cols - 1],
  };
  const next = moves[event.key];
  if (!next) return;
  event.preventDefault();
  const [r, c] = [
    Math.min(rows - 1, Math.max(0, next[0])),
    Math.min(cols - 1, Math.max(0, next[1])),
  ];
  const container = target.closest('table, [data-grid]');
  const cell = container?.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`);
  if (!container || !cell) return;
  for (const other of container.querySelectorAll<HTMLElement>('[data-row]')) {
    other.tabIndex = other === cell ? 0 : -1;
  }
  cell.focus();
}
