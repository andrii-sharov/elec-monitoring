import {
  addDays,
  addMonths,
  dayStart,
  diffDays,
  localDate,
  periodBounds,
  type LocalDate,
  type OutageCause,
  type OutageKind,
  type OutageType,
  type StatsBucketKind,
  type StatsPeriod,
} from '@elec/shared';
import type { DeviceStats, StatsBucket, StatsQuery } from '@elec/shared/api';

const HOUR_MS = 3_600_000;
const DAY_BUCKETS_MAX_DAYS = 31;

export type StatsOutage = {
  type: OutageType;
  startedAt: number;
  endedAt: number | null;
  cause: OutageCause | null;
  kind: OutageKind | null;
};

export type StatsRange = { period: StatsPeriod; from: LocalDate; to: LocalDate };

type Slot = { start: number; end: number };

type Span = StatsOutage & Slot;

export function resolveRange(query: StatsQuery, timezone: string, now: number): StatsRange {
  if (query.period === 'CUSTOM') {
    const from = query.from ?? localDate(now, timezone);
    return { period: query.period, from, to: query.to ?? from };
  }
  const anchor = query.from ?? localDate(now, timezone);
  const kind = query.period.toLowerCase() as 'day' | 'week' | 'month' | 'year';
  return { period: query.period, ...periodBounds(kind, anchor) };
}

export function rangeSlot(range: StatsRange, timezone: string): Slot {
  return { start: dayStart(range.from, timezone), end: dayStart(addDays(range.to, 1), timezone) };
}

function hourSlots(whole: Slot): Slot[] {
  const slots: Slot[] = [];
  for (let start = whole.start; start < whole.end; start += HOUR_MS) {
    slots.push({ start, end: Math.min(start + HOUR_MS, whole.end) });
  }
  return slots;
}

function daySlots(range: StatsRange, timezone: string): Slot[] {
  const count = diffDays(range.from, range.to) + 1;
  return Array.from({ length: count }, (_day, index) => {
    const date = addDays(range.from, index);
    return { start: dayStart(date, timezone), end: dayStart(addDays(date, 1), timezone) };
  });
}

function monthSlots(range: StatsRange, timezone: string): Slot[] {
  const slots: Slot[] = [];
  const after = addDays(range.to, 1);
  for (let cursor = range.from; cursor <= range.to; cursor = addMonths(cursor, 1)) {
    const next = addMonths(cursor, 1);
    const end = next < after ? next : after;
    slots.push({ start: dayStart(cursor, timezone), end: dayStart(end, timezone) });
  }
  return slots;
}

export function bucketsFor(
  range: StatsRange,
  timezone: string,
): { bucket: StatsBucketKind; slots: Slot[] } {
  if (range.period === 'DAY') {
    return { bucket: 'HOUR', slots: hourSlots(rangeSlot(range, timezone)) };
  }
  if (diffDays(range.from, range.to) + 1 <= DAY_BUCKETS_MAX_DAYS) {
    return { bucket: 'DAY', slots: daySlots(range, timezone) };
  }
  return { bucket: 'MONTH', slots: monthSlots(range, timezone) };
}

function overlaps(span: Slot, slot: Slot): boolean {
  return span.start < slot.end && (span.end > slot.start || span.start >= slot.start);
}

function clippedMs(span: Slot, window: Slot): number {
  return Math.max(0, Math.min(span.end, window.end) - Math.max(span.start, window.start));
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

type Summary = {
  outages: Span[];
  powerBlips: number;
  downtimeMs: number;
  availability: number | null;
};

function summarize(
  slot: Slot,
  spans: Span[],
  now: number,
  monitoringSince: number | null,
): Summary {
  const inSlot = spans.filter((span) => overlaps(span, slot));
  const outages = inSlot.filter((span) => span.type === 'OUTAGE');
  const elapsed = { start: slot.start, end: Math.min(slot.end, now) };
  const downtimeMs = outages.reduce((total, span) => total + clippedMs(span, elapsed), 0);
  let availability: number | null = null;
  if (monitoringSince !== null) {
    const window = { start: Math.max(slot.start, monitoringSince), end: elapsed.end };
    const monitoredMs = window.end - window.start;
    if (monitoredMs > 0) {
      const downMs = outages.reduce((total, span) => total + clippedMs(span, window), 0);
      availability = roundPct(((monitoredMs - downMs) / monitoredMs) * 100);
    }
  }
  return {
    outages,
    powerBlips: inSlot.length - outages.length,
    downtimeMs,
    availability,
  };
}

const seconds = (ms: number) => Math.floor(ms / 1000);

export function computeStats(input: {
  range: StatsRange;
  timezone: string;
  now: number;
  monitoringSince: number | null;
  shortOutageThresholdS: number;
  outages: StatsOutage[];
}): DeviceStats {
  const { range, timezone, now, monitoringSince } = input;
  const spans: Span[] = input.outages.map((outage) => ({
    ...outage,
    start: outage.startedAt,
    end: Math.max(outage.startedAt, outage.endedAt ?? now),
  }));
  const whole = rangeSlot(range, timezone);
  const total = summarize(whole, spans, now, monitoringSince);
  const { bucket, slots } = bucketsFor(range, timezone);
  const buckets: StatsBucket[] = slots.map((slot) => {
    const summary = summarize(slot, spans, now, monitoringSince);
    return {
      from: new Date(slot.start).toISOString(),
      to: new Date(slot.end).toISOString(),
      outages: summary.outages.length,
      power_blips: summary.powerBlips,
      total_downtime_s: seconds(summary.downtimeMs),
      availability_pct: summary.availability,
    };
  });
  const closed = total.outages.filter((span) => span.endedAt !== null);
  const countCause = (cause: OutageCause) => closed.filter((span) => span.cause === cause).length;
  const durations = total.outages.map((span) => seconds(span.end - span.start));
  const thresholdMs = input.shortOutageThresholdS * 1000;
  return {
    period: range.period,
    timezone,
    from: new Date(whole.start).toISOString(),
    to: new Date(whole.end).toISOString(),
    bucket,
    monitoring_since: monitoringSince === null ? null : new Date(monitoringSince).toISOString(),
    outages: total.outages.length,
    long_outages: total.outages.filter((span) =>
      span.endedAt === null ? now - span.startedAt >= thresholdMs : span.kind === 'LONG',
    ).length,
    open_outage: total.outages.length > closed.length,
    power_blips: total.powerBlips,
    by_cause: {
      power: countCause('POWER'),
      network: countCause('NETWORK'),
      unknown: countCause('UNKNOWN'),
    },
    total_downtime_s: seconds(total.downtimeMs),
    avg_outage_s:
      durations.length === 0
        ? null
        : Math.floor(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    longest_outage_s: durations.length === 0 ? null : Math.max(...durations),
    availability_pct: total.availability,
    buckets,
  };
}
