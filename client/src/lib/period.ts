import { addDays, diffDays, isWeekStart, localDate, weekdayOf, type LocalDate } from './week';

export const periods = ['day', 'week', 'month', 'year', 'custom'] as const;
export type Period = (typeof periods)[number];

export type Range = { period: Period; from: LocalDate; to: LocalDate };

export const MAX_CUSTOM_DAYS = 366;
export const GRID_MAX_DAYS = 31;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string | null): value is LocalDate {
  return (
    value !== null &&
    datePattern.test(value) &&
    new Date(Date.parse(value)).toISOString().slice(0, 10) === value
  );
}

function monthStart(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: LocalDate, months: number): LocalDate {
  const [year = 1970, month = 1] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1 + months, 1));
  return value.toISOString().slice(0, 10);
}

export function periodRange(period: Exclude<Period, 'custom'>, anchor: LocalDate): Range {
  switch (period) {
    case 'day':
      return { period, from: anchor, to: anchor };
    case 'week': {
      const from = addDays(anchor, -weekdayOf(anchor));
      return { period, from, to: addDays(from, 6) };
    }
    case 'month': {
      const from = monthStart(anchor);
      return { period, from, to: addDays(addMonths(from, 1), -1) };
    }
    case 'year': {
      const year = anchor.slice(0, 4);
      return { period, from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }
}

export function rangeLength(range: Range): number {
  return diffDays(range.from, range.to) + 1;
}

export function shiftRange(range: Range, direction: 1 | -1): Range {
  switch (range.period) {
    case 'day':
    case 'week':
    case 'custom': {
      const step = rangeLength(range) * direction;
      return { ...range, from: addDays(range.from, step), to: addDays(range.to, step) };
    }
    case 'month':
      return periodRange('month', addMonths(range.from, direction));
    case 'year':
      return periodRange('year', `${Number(range.from.slice(0, 4)) + direction}-01-01`);
  }
}

export function containsToday(range: Range, today: LocalDate): boolean {
  return range.from <= today && today <= range.to;
}

export function todayIn(now: number, timezone: string): LocalDate {
  return localDate(now, timezone);
}

export function parseRange(params: URLSearchParams, today: LocalDate): Range {
  const legacyWeek = params.get('week');
  if (!params.get('period') && legacyWeek && isWeekStart(legacyWeek) && legacyWeek <= today) {
    return periodRange('week', legacyWeek);
  }
  const period = periods.find((choice) => choice === params.get('period')) ?? 'week';
  const from = params.get('from');
  const anchor = isDate(from) && from <= today ? from : today;
  if (period !== 'custom') return periodRange(period, anchor);
  const to = params.get('to');
  if (!isDate(from) || !isDate(to) || to < from || from > today) return periodRange('week', today);
  const capped = diffDays(from, to) + 1 > MAX_CUSTOM_DAYS ? addDays(from, MAX_CUSTOM_DAYS - 1) : to;
  return { period, from, to: capped };
}

export function rangeParams(range: Range, today: LocalDate): Record<string, string | null> {
  const current = range.period !== 'custom' && containsToday(range, today);
  return {
    period: range.period === 'week' ? null : range.period,
    from: current ? null : range.from,
    to: range.period === 'custom' ? range.to : null,
    week: null,
  };
}

export function monthChunks(range: Range): { from: LocalDate; to: LocalDate }[] {
  const chunks: { from: LocalDate; to: LocalDate }[] = [];
  let from = range.from;
  while (from <= range.to) {
    const end = addDays(addMonths(monthStart(from), 1), -1);
    const to = end < range.to ? end : range.to;
    chunks.push({ from, to });
    from = addDays(to, 1);
  }
  return chunks;
}
