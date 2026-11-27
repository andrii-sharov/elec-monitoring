import { dayStart } from '@elec/shared';
import { describe, expect, test } from 'vitest';
import { bucketsFor, computeStats, resolveRange, type StatsOutage } from './compute.ts';

const kyiv = 'Europe/Kyiv';
const berlin = 'Europe/Berlin';
const at = (iso: string) => Date.parse(iso);

function outage(start: string, end: string | null, extra: Partial<StatsOutage> = {}): StatsOutage {
  return {
    type: 'OUTAGE',
    startedAt: at(start),
    endedAt: end === null ? null : at(end),
    cause: end === null ? null : 'POWER',
    kind: end === null ? null : 'SHORT',
    ...extra,
  };
}

function stats(input: {
  period: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';
  from: string;
  to?: string;
  timezone?: string;
  now?: string;
  monitoringSince?: string | null;
  threshold?: number;
  outages?: StatsOutage[];
}) {
  const timezone = input.timezone ?? kyiv;
  const now = at(input.now ?? '2027-01-01T00:00:00Z');
  const query =
    input.period === 'CUSTOM'
      ? { period: input.period, from: input.from, to: input.to }
      : { period: input.period, from: input.from };
  return computeStats({
    range: resolveRange(query, timezone, now),
    timezone,
    now,
    monitoringSince:
      input.monitoringSince === null ? null : at(input.monitoringSince ?? '2026-01-01T00:00:00Z'),
    shortOutageThresholdS: input.threshold ?? 180,
    outages: input.outages ?? [],
  });
}

describe('resolveRange', () => {
  test('snaps a date to its period', () => {
    expect(resolveRange({ period: 'WEEK', from: '2026-11-27' }, kyiv, 0)).toEqual({
      period: 'WEEK',
      from: '2026-11-23',
      to: '2026-11-29',
    });
  });

  test('defaults to today in the timezone', () => {
    expect(resolveRange({ period: 'DAY' }, kyiv, at('2026-11-26T23:30:00Z'))).toEqual({
      period: 'DAY',
      from: '2026-11-27',
      to: '2026-11-27',
    });
  });
});

describe('bucketsFor', () => {
  test('a DST day has 23 or 25 hour buckets', () => {
    const spring = bucketsFor({ period: 'DAY', from: '2026-03-29', to: '2026-03-29' }, berlin);
    expect(spring.bucket).toBe('HOUR');
    expect(spring.slots).toHaveLength(23);
    expect(spring.slots.reduce((sum, s) => sum + s.end - s.start, 0)).toBe(82_800_000);
    const autumn = bucketsFor({ period: 'DAY', from: '2026-10-25', to: '2026-10-25' }, berlin);
    expect(autumn.slots).toHaveLength(25);
  });

  test('days for weeks, months and short custom ranges', () => {
    expect(
      bucketsFor({ period: 'WEEK', from: '2026-11-23', to: '2026-11-29' }, kyiv),
    ).toMatchObject({ bucket: 'DAY', slots: { length: 7 } });
    expect(
      bucketsFor({ period: 'MONTH', from: '2026-11-01', to: '2026-11-30' }, kyiv),
    ).toMatchObject({ bucket: 'DAY', slots: { length: 30 } });
    expect(
      bucketsFor({ period: 'CUSTOM', from: '2026-11-01', to: '2026-12-01' }, kyiv),
    ).toMatchObject({ bucket: 'DAY', slots: { length: 31 } });
  });

  test('months for a year and long custom ranges, clipped to the range', () => {
    expect(
      bucketsFor({ period: 'YEAR', from: '2026-01-01', to: '2026-12-31' }, kyiv),
    ).toMatchObject({ bucket: 'MONTH', slots: { length: 12 } });
    const custom = bucketsFor({ period: 'CUSTOM', from: '2026-01-15', to: '2026-03-10' }, kyiv);
    expect(custom.bucket).toBe('MONTH');
    expect(custom.slots).toHaveLength(3);
    expect(custom.slots[0]?.start).toBe(dayStart('2026-01-15', kyiv));
    expect(custom.slots[1]?.start).toBe(dayStart('2026-02-01', kyiv));
    expect(custom.slots[2]?.end).toBe(dayStart('2026-03-11', kyiv));
  });
});

describe('computeStats', () => {
  test('an outage across midnight counts in both days and splits its downtime', () => {
    const result = stats({
      period: 'WEEK',
      from: '2026-11-16',
      outages: [outage('2026-11-17T21:30:00Z', '2026-11-17T23:15:00Z')],
    });
    expect(result.outages).toBe(1);
    expect(result.total_downtime_s).toBe(6300);
    expect(result.buckets[1]).toMatchObject({ outages: 1, total_downtime_s: 1800 });
    expect(result.buckets[2]).toMatchObject({ outages: 1, total_downtime_s: 4500 });
    expect(result.buckets[0]).toMatchObject({ outages: 0, total_downtime_s: 0 });
    expect(result.from).toBe('2026-11-15T22:00:00.000Z');
    expect(result.to).toBe('2026-11-22T22:00:00.000Z');
  });

  test('an outage over the spring DST gap lasts one real hour', () => {
    const result = stats({
      period: 'DAY',
      from: '2026-03-29',
      timezone: berlin,
      outages: [outage('2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z')],
    });
    expect(result.total_downtime_s).toBe(3600);
    expect(result.buckets).toHaveLength(23);
  });

  test('an open outage runs until now and future buckets have no availability', () => {
    const result = stats({
      period: 'DAY',
      from: '2026-11-27',
      now: '2026-11-27T10:00:00Z',
      outages: [
        outage('2026-11-27T05:00:00Z', '2026-11-27T05:10:00Z'),
        outage('2026-11-27T08:00:00Z', null),
      ],
    });
    expect(result).toMatchObject({
      outages: 2,
      open_outage: true,
      long_outages: 1,
      by_cause: { power: 1, network: 0, unknown: 0 },
      total_downtime_s: 7800,
      avg_outage_s: 3900,
      longest_outage_s: 7200,
      availability_pct: 81.94,
    });
    const future = result.buckets.slice(12);
    expect(future.every((b) => b.availability_pct === null && b.total_downtime_s === 0)).toBe(true);
    expect(result.buckets[11]).toMatchObject({
      outages: 1,
      total_downtime_s: 3600,
      availability_pct: 0,
    });
  });

  test('an open outage shorter than the threshold is not long yet', () => {
    const result = stats({
      period: 'DAY',
      from: '2026-11-27',
      now: '2026-11-27T10:00:00Z',
      outages: [outage('2026-11-27T09:59:00Z', null)],
    });
    expect(result.long_outages).toBe(0);
    expect(result.open_outage).toBe(true);
  });

  test('time before the first check-in is not counted', () => {
    const result = stats({
      period: 'DAY',
      from: '2026-11-20',
      monitoringSince: '2026-11-20T10:00:00Z',
      outages: [outage('2026-11-20T12:00:00Z', '2026-11-20T13:00:00Z', { kind: 'LONG' })],
    });
    expect(result.availability_pct).toBe(91.67);
    expect(result.buckets[0]?.availability_pct).toBeNull();
    expect(result.buckets[12]?.availability_pct).toBe(100);
    expect(result.long_outages).toBe(1);
    expect(result.monitoring_since).toBe('2026-11-20T10:00:00.000Z');
  });

  test('a device that never checked in has counts but no availability', () => {
    const result = stats({ period: 'WEEK', from: '2026-11-16', monitoringSince: null });
    expect(result.availability_pct).toBeNull();
    expect(result.buckets.every((b) => b.availability_pct === null)).toBe(true);
    expect(result.monitoring_since).toBeNull();
    expect(result.outages).toBe(0);
  });

  test('a power blip counts only as a blip', () => {
    const result = stats({
      period: 'WEEK',
      from: '2026-11-16',
      outages: [outage('2026-11-18T10:00:00Z', '2026-11-18T10:00:25Z', { type: 'POWER_BLIP' })],
    });
    expect(result).toMatchObject({
      outages: 0,
      power_blips: 1,
      total_downtime_s: 0,
      availability_pct: 100,
      by_cause: { power: 0, network: 0, unknown: 0 },
    });
    expect(result.buckets[2]?.power_blips).toBe(1);
  });

  test('an outage from before the range is clipped but keeps its full length', () => {
    const result = stats({
      period: 'WEEK',
      from: '2026-11-16',
      outages: [
        outage('2026-11-15T20:00:00Z', '2026-11-16T00:00:00Z', { cause: 'NETWORK', kind: 'LONG' }),
      ],
    });
    expect(result).toMatchObject({
      outages: 1,
      total_downtime_s: 7200,
      longest_outage_s: 14400,
      avg_outage_s: 14400,
      by_cause: { power: 0, network: 1, unknown: 0 },
    });
  });

  test('rounds availability and floors the average', () => {
    const tiny = stats({
      period: 'DAY',
      from: '2026-11-20',
      outages: [outage('2026-11-20T10:00:00Z', '2026-11-20T10:00:01Z')],
    });
    expect(tiny.availability_pct).toBe(100);
    const ten = stats({
      period: 'DAY',
      from: '2026-11-20',
      outages: [
        outage('2026-11-20T10:00:00Z', '2026-11-20T10:05:00Z'),
        outage('2026-11-20T11:00:00Z', '2026-11-20T11:05:01Z'),
      ],
    });
    expect(ten.availability_pct).toBe(99.3);
    expect(ten.avg_outage_s).toBe(300);
    const none = stats({ period: 'DAY', from: '2026-11-20' });
    expect(none).toMatchObject({
      avg_outage_s: null,
      longest_outage_s: null,
      availability_pct: 100,
    });
  });
});
