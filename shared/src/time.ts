const dayMs = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type LocalDate = string;

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

const partsFormat = new Map<string, Intl.DateTimeFormat>();

function formatFor(timezone: string): Intl.DateTimeFormat {
  let format = partsFormat.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormat.set(timezone, format);
  }
  return format;
}

function wallClock(at: number, timezone: string) {
  const parts = formatFor(timezone).formatToParts(at);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

function offsetAt(at: number, timezone: string): number {
  const w = wallClock(at, timezone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - (at - (at % 1000));
}

function parseDate(date: LocalDate) {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return { year, month, day };
}

function toDate(utcMidnight: number): LocalDate {
  return new Date(utcMidnight).toISOString().slice(0, 10);
}

export function isLocalDate(value: unknown): value is LocalDate {
  return (
    typeof value === 'string' && datePattern.test(value) && toDate(Date.parse(value)) === value
  );
}

export function zonedTime(date: LocalDate, hour: number, timezone: string): number {
  const { year, month, day } = parseDate(date);
  const wall = Date.UTC(year, month - 1, day, hour);
  let guess = wall - offsetAt(wall, timezone);
  guess = wall - offsetAt(guess, timezone);
  return guess;
}

export function dayStart(date: LocalDate, timezone: string): number {
  return zonedTime(date, 0, timezone);
}

export function localDate(at: number, timezone: string): LocalDate {
  const w = wallClock(at, timezone);
  return toDate(Date.UTC(w.year, w.month - 1, w.day));
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseDate(date);
  return toDate(Date.UTC(year, month - 1, day) + days * dayMs);
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month } = parseDate(date);
  return toDate(Date.UTC(year, month - 1 + months, 1));
}

export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / dayMs);
}

export function weekdayOf(date: LocalDate): number {
  const { year, month, day } = parseDate(date);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function monthStart(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function periodBounds(
  period: PeriodKind,
  anchor: LocalDate,
): { from: LocalDate; to: LocalDate } {
  switch (period) {
    case 'day':
      return { from: anchor, to: anchor };
    case 'week': {
      const from = addDays(anchor, -weekdayOf(anchor));
      return { from, to: addDays(from, 6) };
    }
    case 'month': {
      const from = monthStart(anchor);
      return { from, to: addDays(addMonths(from, 1), -1) };
    }
    case 'year': {
      const year = anchor.slice(0, 4);
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }
}
