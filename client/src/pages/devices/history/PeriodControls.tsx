import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segment, SegmentedControl } from '@/components/ui/segmented-control';
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
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { addDays, diffDays, type LocalDate } from '@/lib/week';

type Props = { range: Range; today: LocalDate; onChange: (range: Range) => void };

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

function RangeForm({
  range,
  today,
  onChange,
  title,
}: Props & { title: (text: string) => ReactNode }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to > today ? today : range.to);
  const tooLong = diffDays(from, to) + 1 > MAX_CUSTOM_DAYS;
  const invalid = !from || !to || to < from || from > today || tooLong;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    onChange({ period: 'custom', from, to });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {title(t('app.history.custom.title'))}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="history-from">{t('app.history.custom.from')}</Label>
          <Input
            id="history-from"
            type="date"
            value={from}
            max={today}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
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
  );
}

function CustomRange({ range, today, onChange }: Props) {
  const { t } = useTranslation();
  const phone = useMediaQuery('(width < 40rem)');
  const [open, setOpen] = useState(false);
  const choose = (next: Range) => {
    onChange(next);
    setOpen(false);
  };
  const trigger = (
    <>
      <CalendarRange aria-hidden="true" />
      <span className="max-sm:sr-only">{t('app.history.periods.custom')}</span>
    </>
  );
  if (phone) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Segment aria-pressed={range.period === 'custom'} />}>
          {trigger}
        </DialogTrigger>
        <DialogContent>
          <RangeForm
            range={range}
            today={today}
            onChange={choose}
            title={(text) => <DialogTitle>{text}</DialogTitle>}
          />
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Segment aria-pressed={range.period === 'custom'} />}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <RangeForm
          range={range}
          today={today}
          onChange={choose}
          title={(text) => <p className="font-medium">{text}</p>}
        />
      </PopoverContent>
    </Popover>
  );
}

export function PeriodSelect({ range, today, onChange }: Props) {
  const { t } = useTranslation();
  const choose = (period: Exclude<Period, 'custom'>) => onChange(periodRange(period, today));
  return (
    <SegmentedControl label={t('app.history.period')}>
      {periods
        .filter((period) => period !== 'custom')
        .map((period) => (
          <Segment
            key={period}
            aria-pressed={range.period === period}
            onClick={() => choose(period as Exclude<Period, 'custom'>)}
          >
            {t(`app.history.periods.${period}`)}
          </Segment>
        ))}
      <CustomRange range={range} today={today} onChange={onChange} />
    </SegmentedControl>
  );
}

export function PeriodNav({ range, today, onChange }: Props) {
  const { t } = useTranslation();
  const label = useRangeLabel(range);
  const next = shiftRange(range, 1);
  const current =
    range.period === 'custom' ? periodRange('week', today) : periodRange(range.period, today);
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t(`app.history.previous.${range.period}`)}
        onClick={() => onChange(shiftRange(range, -1))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <span
        aria-live="polite"
        className="min-w-36 text-center text-sm font-medium tabular-nums max-sm:min-w-0 max-sm:flex-1"
      >
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
