import type { OutageItem } from '@elec/shared/api';

const dayMs = 86_400_000;

export type LocalDate = string;

export type Slot = { start: number; end: number };

export type Day = Slot & { date: LocalDate; weekday: number; hours: Slot[] };

export type HourCell = Slot & {
  offMs: number;
  blips: number;
  future: boolean;
};

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

export function zonedTime(date: LocalDate, hour: number, timezone: string): number {
  const { year, month, day } = parseDate(date);
  const wall = Date.UTC(year, month - 1, day, hour);
  let guess = wall - offsetAt(wall, timezone);
  guess = wall - offsetAt(guess, timezone);
  return guess;
}

export function localDate(at: number, timezone: string): LocalDate {
  const w = wallClock(at, timezone);
  return toDate(Date.UTC(w.year, w.month - 1, w.day));
}

function toDate(utcMidnight: number): LocalDate {
  return new Date(utcMidnight).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseDate(date);
  return toDate(Date.UTC(year, month - 1, day) + days * dayMs);
}

function weekdayOf(date: LocalDate): number {
  const { year, month, day } = parseDate(date);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function weekStart(at: number, timezone: string): LocalDate {
  const date = localDate(at, timezone);
  return addDays(date, -weekdayOf(date));
}

export function isWeekStart(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    toDate(Date.parse(value)) === value &&
    weekdayOf(value) === 0
  );
}

export function weekDays(monday: LocalDate, timezone: string): Day[] {
  return Array.from({ length: 7 }, (_day, weekday) => {
    const date = addDays(monday, weekday);
    const start = zonedTime(date, 0, timezone);
    const end = zonedTime(addDays(date, 1), 0, timezone);
    const hours = Array.from({ length: 24 }, (_slot, hour) => ({
      start: Math.max(start, zonedTime(date, hour, timezone)),
      end: Math.min(end, hour === 23 ? end : zonedTime(date, hour + 1, timezone)),
    }));
    return { date, weekday, start, end, hours };
  });
}

function overlap(a: Slot, b: Slot): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function outageSlot(outage: OutageItem, now: number): Slot {
  const start = Date.parse(outage.started_at);
  const end = outage.ended_at === null ? now : Date.parse(outage.ended_at);
  return { start, end: Math.max(start, end) };
}

export function hourCells(day: Day, outages: OutageItem[], now: number): HourCell[] {
  const off = outages.filter((outage) => outage.type === 'OUTAGE').map((o) => outageSlot(o, now));
  const blips = outages
    .filter((outage) => outage.type === 'POWER_BLIP')
    .map((outage) => Date.parse(outage.started_at));
  return day.hours.map((slot) => ({
    ...slot,
    offMs: Math.min(
      slot.end - slot.start,
      off.reduce((total, outage) => total + overlap(outage, slot), 0),
    ),
    blips: blips.filter((at) => at >= slot.start && at < slot.end).length,
    future: slot.start >= now,
  }));
}

export function groupByDay(days: Day[], outages: OutageItem[]): Map<LocalDate, OutageItem[]> {
  const groups = new Map<LocalDate, OutageItem[]>();
  const first = days[0];
  if (!first) return groups;
  for (const outage of outages) {
    const at = Math.max(Date.parse(outage.started_at), first.start);
    const day = days.find((candidate) => at >= candidate.start && at < candidate.end);
    if (!day) continue;
    groups.set(day.date, [...(groups.get(day.date) ?? []), outage]);
  }
  return groups;
}

export function outagesIn(slot: Slot, outages: OutageItem[], now: number): OutageItem[] {
  return outages.filter((outage) => {
    const span = outageSlot(outage, now);
    return span.start < slot.end && (span.end > slot.start || span.start >= slot.start);
  });
}
