import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PopoverContent } from '@/components/ui/popover';
import { useFormatters } from '@/lib/format';
import {
  containsToday,
  MAX_CUSTOM_DAYS,
  periodRange,
  periods,
  shiftRange,
  type Period,
  type Range,
} from '@/lib/period';
import { cn } from '@/lib/utils';
import { addDays, diffDays, type LocalDate } from '@/lib/week';

type Props = { range: Range; today: LocalDate; onChange: (range: Range) => void };

const segment =
  'h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm';

function useRangeLabel(range: Range): string {
  const format = useFormatters();
  switch (range.period) {
    case 'day':
      return format.day(range.from, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    case 'month':
      return format.day(range.from, { month: 'long', year: 'numeric' });
    case 'year':
      return range.from.slice(0, 4);
    default:
      return format.days(range.from, range.to);
  }
}

function CustomRange({ range, today, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to > today ? today : range.to);
  const tooLong = diffDays(from, to) + 1 > MAX_CUSTOM_DAYS;
  const invalid = !from || !to || to < from || from > today || tooLong;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    onChange({ period: 'custom', from, to });
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        aria-pressed={range.period === 'custom'}
        className={cn(segment, 'flex items-center gap-1')}
      >
        <CalendarRange aria-hidden="true" className="size-3.5" />
        {t('app.history.periods.custom')}
      </PopoverPrimitive.Trigger>
      <PopoverContent align="end" className="w-72">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="font-medium">{t('app.history.custom.title')}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="history-from">{t('app.history.custom.from')}</Label>
              <Input
                id="history-from"
                type="date"
                value={from}
                max={today}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="history-to">{t('app.history.custom.to')}</Label>
              <Input
                id="history-to"
                type="date"
                value={to}
                min={from}
                max={addDays(from, MAX_CUSTOM_DAYS - 1)}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
          <p className={cn('text-xs', tooLong ? 'text-danger' : 'text-muted-foreground')}>
            {t('app.history.custom.hint', { days: MAX_CUSTOM_DAYS })}
          </p>
          <Button type="submit" size="sm" disabled={invalid}>
            {t('app.history.custom.apply')}
          </Button>
        </form>
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

export function PeriodSelect({ range, today, onChange }: Props) {
  const { t } = useTranslation();
  const choose = (period: Exclude<Period, 'custom'>) => onChange(periodRange(period, today));
  return (
    <fieldset className="flex w-fit flex-wrap items-center gap-0.5 rounded-lg bg-secondary p-0.5">
      <legend className="sr-only">{t('app.history.period')}</legend>
      {periods
        .filter((period) => period !== 'custom')
        .map((period) => (
          <button
            key={period}
            type="button"
            aria-pressed={range.period === period}
            onClick={() => choose(period as Exclude<Period, 'custom'>)}
            className={segment}
          >
            {t(`app.history.periods.${period}`)}
          </button>
        ))}
      <CustomRange range={range} today={today} onChange={onChange} />
    </fieldset>
  );
}

export function PeriodNav({ range, today, onChange }: Props) {
  const { t } = useTranslation();
  const label = useRangeLabel(range);
  const next = shiftRange(range, 1);
  const current =
    range.period === 'custom' ? periodRange('week', today) : periodRange(range.period, today);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t(`app.history.previous.${range.period}`)}
        onClick={() => onChange(shiftRange(range, -1))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <span aria-live="polite" className="min-w-36 text-center text-sm font-medium tabular-nums">
        {label}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t(`app.history.next.${range.period}`)}
        disabled={next.from > today}
        onClick={() => onChange(next)}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
      {range.period !== 'custom' && containsToday(range, today) ? null : (
        <Button variant="ghost" size="sm" onClick={() => onChange(current)}>
          {t(`app.history.current.${range.period}`)}
        </Button>
      )}
    </div>
  );
}
