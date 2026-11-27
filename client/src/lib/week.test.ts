import { expect, test } from 'vitest';
import { outageFixture } from '../../test/fixtures.ts';
import {
  addDays,
  groupByDay,
  hourCells,
  isWeekStart,
  localDate,
  weekDays,
  weekStart,
  zonedTime,
} from './week.ts';

const kyiv = 'Europe/Kyiv';

test('finds the Monday of the local week', () => {
  expect(weekStart(Date.parse('2026-11-26T12:00:00Z'), kyiv)).toBe('2026-11-23');
  expect(weekStart(Date.parse('2026-11-22T22:30:00Z'), kyiv)).toBe('2026-11-23');
  expect(weekStart(Date.parse('2026-11-22T22:30:00Z'), 'UTC')).toBe('2026-11-16');
});

test('converts a local wall time to an instant', () => {
  expect(new Date(zonedTime('2026-11-23', 0, kyiv)).toISOString()).toBe('2026-11-22T22:00:00.000Z');
  expect(new Date(zonedTime('2026-07-01', 14, kyiv)).toISOString()).toBe(
    '2026-07-01T11:00:00.000Z',
  );
  expect(localDate(Date.parse('2026-11-22T22:00:00Z'), kyiv)).toBe('2026-11-23');
});

test('adds days across months and validates week starts', () => {
  expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  expect(isWeekStart('2026-11-23')).toBe(true);
  expect(isWeekStart('2026-11-24')).toBe(false);
  expect(isWeekStart('2026-02-30')).toBe(false);
  expect(isWeekStart('nonsense')).toBe(false);
});

test('builds seven days of 24 hours that cover DST changes', () => {
  const spring = weekDays('2026-03-23', kyiv);
  const sunday = spring[6];
  expect(sunday?.date).toBe('2026-03-29');
  expect((sunday?.end ?? 0) - (sunday?.start ?? 0)).toBe(23 * 3_600_000);
  expect(sunday?.hours).toHaveLength(24);
  const autumn = weekDays('2026-10-19', kyiv)[6];
  expect((autumn?.end ?? 0) - (autumn?.start ?? 0)).toBe(25 * 3_600_000);
  for (const day of [...spring, ...weekDays('2026-10-19', kyiv)]) {
    expect(day.hours[0]?.start).toBe(day.start);
    expect(day.hours[23]?.end).toBe(day.end);
  }
});

test('measures time without power per hour, marks blips and the future', () => {
  const day = weekDays('2026-11-23', kyiv)[0];
  if (!day) throw new Error('no day');
  const cells = hourCells(
    day,
    [
      outageFixture({ started_at: '2026-11-23T08:20:00Z', ended_at: '2026-11-23T10:00:00Z' }),
      outageFixture({
        id: 'blip',
        type: 'POWER_BLIP',
        started_at: '2026-11-23T13:05:00Z',
        ended_at: '2026-11-23T13:05:02Z',
      }),
      outageFixture({ id: 'open', started_at: '2026-11-23T15:30:00Z', ended_at: null }),
    ],
    Date.parse('2026-11-23T16:00:00Z'),
  );
  expect(cells[10]?.offMs).toBe(40 * 60_000);
  expect(cells[11]?.offMs).toBe(60 * 60_000);
  expect(cells[12]?.offMs).toBe(0);
  expect(cells[15]?.blips).toBe(1);
  expect(cells[15]?.offMs).toBe(0);
  expect(cells[17]?.offMs).toBe(30 * 60_000);
  expect(cells[17]?.future).toBe(false);
  expect(cells[18]?.future).toBe(true);
  expect(cells[18]?.offMs).toBe(0);
});

test('groups outages by the local day they start, clamped to the week', () => {
  const days = weekDays('2026-11-23', kyiv);
  const groups = groupByDay(days, [
    outageFixture({
      id: 'late',
      started_at: '2026-11-24T22:30:00Z',
      ended_at: '2026-11-24T23:00:00Z',
    }),
    outageFixture({
      id: 'carried',
      started_at: '2026-11-21T10:00:00Z',
      ended_at: '2026-11-23T01:00:00Z',
    }),
  ]);
  expect(groups.get('2026-11-25')?.map((o) => o.id)).toEqual(['late']);
  expect(groups.get('2026-11-23')?.map((o) => o.id)).toEqual(['carried']);
});

test('finds outages and blips that touch an hour', async () => {
  const { outagesIn } = await import('./week.ts');
  const slot = {
    start: Date.parse('2026-11-23T10:00:00Z'),
    end: Date.parse('2026-11-23T11:00:00Z'),
  };
  const items = [
    outageFixture({
      id: 'over',
      started_at: '2026-11-23T09:30:00Z',
      ended_at: '2026-11-23T10:10:00Z',
    }),
    outageFixture({
      id: 'before',
      started_at: '2026-11-23T09:00:00Z',
      ended_at: '2026-11-23T10:00:00Z',
    }),
    outageFixture({
      id: 'blip',
      type: 'POWER_BLIP',
      started_at: '2026-11-23T10:30:00Z',
      ended_at: '2026-11-23T10:30:00Z',
    }),
    outageFixture({ id: 'open', started_at: '2026-11-23T10:50:00Z', ended_at: null }),
  ];
  expect(outagesIn(slot, items, Date.parse('2026-11-23T12:00:00Z')).map((o) => o.id)).toEqual([
    'over',
    'blip',
    'open',
  ]);
});

test('sums a whole day without power and its blips', async () => {
  const { daySummary } = await import('./week.ts');
  const day = weekDays('2026-11-23', kyiv)[0];
  if (!day) throw new Error('no day');
  const summary = daySummary(
    day,
    [
      outageFixture({ started_at: '2026-11-22T21:00:00Z', ended_at: '2026-11-22T23:00:00Z' }),
      outageFixture({ id: 'b', type: 'POWER_BLIP', started_at: '2026-11-23T08:00:00Z' }),
    ],
    Date.parse('2026-11-24T00:00:00Z'),
  );
  expect(summary.offMs).toBe(60 * 60_000);
  expect(summary.blips).toBe(1);
  expect(summary.future).toBe(false);
});

test('a network gap is time without internet, not without power', async () => {
  const { daySummary } = await import('./week.ts');
  const day = weekDays('2026-11-23', kyiv)[0];
  if (!day) throw new Error('no day');
  const outages = [
    outageFixture({
      cause: 'NETWORK',
      started_at: '2026-11-23T08:00:00Z',
      ended_at: '2026-11-23T08:10:00Z',
    }),
  ];
  const now = Date.parse('2026-11-24T00:00:00Z');
  const cell = hourCells(day, outages, now)[10];
  expect(cell?.offMs).toBe(0);
  expect(cell?.networkMs).toBe(600_000);
  expect(daySummary(day, outages, now)).toMatchObject({ offMs: 0, networkMs: 600_000 });
});
