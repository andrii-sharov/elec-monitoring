import { describe, expect, test } from 'vitest';
import { isQuietTime } from './format.ts';

describe('isQuietTime', () => {
  const night = { start: '23:00', end: '07:00' };
  const at = (iso: string) => new Date(iso);

  test.each([
    ['2026-11-21T20:59:00Z', false],
    ['2026-11-21T21:00:00Z', true],
    ['2026-11-22T01:00:00Z', true],
    ['2026-11-22T04:59:00Z', true],
    ['2026-11-22T05:00:00Z', false],
  ])('overnight window in Kyiv at %s is %s', (iso, expected) => {
    expect(isQuietTime(at(iso), night, 'Europe/Kyiv')).toBe(expected);
  });

  test.each([
    ['2026-11-21T22:59:00Z', false],
    ['2026-11-21T23:00:00Z', true],
    ['2026-11-22T02:59:00Z', true],
    ['2026-11-22T03:00:00Z', false],
  ])('same-day window 01:00-05:00 in Kyiv at %s is %s', (iso, expected) => {
    expect(isQuietTime(at(iso), { start: '01:00', end: '05:00' }, 'Europe/Kyiv')).toBe(expected);
  });

  test('null quiet hours are never quiet', () => {
    expect(isQuietTime(at('2026-11-21T21:30:00Z'), null, 'Europe/Kyiv')).toBe(false);
  });

  test('accepts HH:MM:SS from the database', () => {
    expect(
      isQuietTime(
        at('2026-11-21T21:30:00Z'),
        { start: '23:00:00', end: '07:00:00' },
        'Europe/Kyiv',
      ),
    ).toBe(true);
  });

  test.each([
    ['2026-10-24T19:59:00Z', false],
    ['2026-10-24T20:00:00Z', true],
    ['2026-10-25T04:59:00Z', true],
    ['2026-10-25T05:00:00Z', false],
  ])('DST change in Kyiv at %s is %s', (iso, expected) => {
    expect(isQuietTime(at(iso), night, 'Europe/Kyiv')).toBe(expected);
  });

  test('uses the recipient timezone', () => {
    const instant = at('2026-10-25T22:00:00Z');
    expect(isQuietTime(instant, night, 'Europe/Kyiv')).toBe(true);
    expect(isQuietTime(instant, night, 'America/New_York')).toBe(false);
  });

  test('invalid timezone falls back to Kyiv', () => {
    expect(isQuietTime(at('2026-11-21T21:30:00Z'), night, 'Mars/Base')).toBe(true);
  });
});
