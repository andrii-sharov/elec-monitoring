import type { OutageItem } from '@elec/shared/api';
import {
  addDays,
  diffDays,
  isLocalDate,
  localDate,
  weekdayOf,
  zonedTime,
  type LocalDate,
} from '@elec/shared';

export { addDays, diffDays, localDate, weekdayOf, zonedTime, type LocalDate } from '@elec/shared';

export type Slot = { start: number; end: number };

export type Day = Slot & { date: LocalDate; weekday: number; hours: Slot[] };

export type HourCell = Slot & {
  offMs: number;
  blips: number;
  future: boolean;
};

export function weekStart(at: number, timezone: string): LocalDate {
  const date = localDate(at, timezone);
  return addDays(date, -weekdayOf(date));
}

export function isWeekStart(value: string): boolean {
  return isLocalDate(value) && weekdayOf(value) === 0;
}

function buildDay(date: LocalDate, timezone: string): Day {
  const start = zonedTime(date, 0, timezone);
  const end = zonedTime(addDays(date, 1), 0, timezone);
  const hours = Array.from({ length: 24 }, (_slot, hour) => ({
    start: Math.max(start, zonedTime(date, hour, timezone)),
    end: Math.min(end, hour === 23 ? end : zonedTime(date, hour + 1, timezone)),
  }));
  return { date, weekday: weekdayOf(date), start, end, hours };
}

export function daysBetween(from: LocalDate, to: LocalDate, timezone: string): Day[] {
  const count = Math.max(0, diffDays(from, to) + 1);
  return Array.from({ length: count }, (_day, index) => buildDay(addDays(from, index), timezone));
}

export function weekDays(monday: LocalDate, timezone: string): Day[] {
  return daysBetween(monday, addDays(monday, 6), timezone);
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

export function daySummary(day: Day, outages: OutageItem[], now: number): HourCell {
  const off = outages.filter((outage) => outage.type === 'OUTAGE').map((o) => outageSlot(o, now));
  const blips = outages.filter(
    (outage) =>
      outage.type === 'POWER_BLIP' &&
      Date.parse(outage.started_at) >= day.start &&
      Date.parse(outage.started_at) < day.end,
  ).length;
  return {
    start: day.start,
    end: day.end,
    offMs: Math.min(
      day.end - day.start,
      off.reduce((total, outage) => total + overlap(outage, day), 0),
    ),
    blips,
    future: day.start >= now,
  };
}
