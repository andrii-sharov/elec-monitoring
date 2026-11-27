import { expect, test } from 'vitest';
import {
  addDays,
  addMonths,
  dayStart,
  diffDays,
  isLocalDate,
  localDate,
  periodBounds,
  weekdayOf,
  zonedTime,
} from './time.ts';

const berlin = 'Europe/Berlin';
const hour = 3_600_000;

test('local days around DST in Berlin are 23 and 25 hours long', () => {
  expect(dayStart('2026-03-30', berlin) - dayStart('2026-03-29', berlin)).toBe(23 * hour);
  expect(dayStart('2026-10-26', berlin) - dayStart('2026-10-25', berlin)).toBe(25 * hour);
  expect(new Date(dayStart('2026-03-29', berlin)).toISOString()).toBe('2026-03-28T23:00:00.000Z');
});

test('reads the local date and converts wall times', () => {
  expect(localDate(Date.parse('2026-10-25T00:30:00Z'), berlin)).toBe('2026-10-25');
  expect(localDate(Date.parse('2026-11-22T22:00:00Z'), 'Europe/Kyiv')).toBe('2026-11-23');
  expect(new Date(zonedTime('2026-07-01', 14, 'Europe/Kyiv')).toISOString()).toBe(
    '2026-07-01T11:00:00.000Z',
  );
});

test('date arithmetic', () => {
  expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
  expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
  expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
  expect(weekdayOf('2026-11-23')).toBe(0);
  expect(weekdayOf('2026-11-29')).toBe(6);
});

test('validates local dates', () => {
  expect(isLocalDate('2026-02-28')).toBe(true);
  expect(isLocalDate('2026-02-30')).toBe(false);
  expect(isLocalDate('2026-2-3')).toBe(false);
  expect(isLocalDate(20260101)).toBe(false);
});

test('period bounds', () => {
  expect(periodBounds('day', '2026-11-27')).toEqual({ from: '2026-11-27', to: '2026-11-27' });
  expect(periodBounds('week', '2026-11-27')).toEqual({ from: '2026-11-23', to: '2026-11-29' });
  expect(periodBounds('month', '2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  expect(periodBounds('year', '2026-06-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
});
