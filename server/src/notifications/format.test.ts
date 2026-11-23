import { describe, expect, test } from 'vitest';
import { createI18n } from '../i18n.ts';
import { formatDuration, formatMoment, formatRange, isQuietTime } from './format.ts';

const i18n = createI18n();
const en = i18n.getFixedT('en');

describe('formatDuration', () => {
  test.each([
    [0, '0 s'],
    [25, '25 s'],
    [59, '59 s'],
    [60, '1 min'],
    [749, '12 min'],
    [3600, '1 h'],
    [8100, '2 h 15 min'],
    [86_399, '23 h 59 min'],
    [97_200, '1 d 3 h'],
    [86_400, '1 d'],
  ])('%i s is %s', (seconds, expected) => {
    expect(formatDuration(seconds, en)).toBe(expected);
  });
});

describe('formatMoment', () => {
  const at = new Date('2026-11-21T16:42:00Z');

  test('en in Kyiv', () => {
    expect(formatMoment(at, 'en', 'Europe/Kyiv')).toBe('21 Nov 18:42');
  });

  test.each(['uk', 'ru'] as const)('%s keeps day and time', (language) => {
    const text = formatMoment(at, language, 'Europe/Kyiv');
    expect(text).toContain('21');
    expect(text).toContain('18:42');
  });

  test('invalid timezone falls back to Kyiv', () => {
    expect(formatMoment(at, 'en', 'Mars/Base')).toBe('21 Nov 18:42');
  });
});

describe('formatRange', () => {
  test('same local day shows times only', () => {
    expect(
      formatRange(
        new Date('2026-11-21T16:42:00Z'),
        new Date('2026-11-21T18:57:00Z'),
        'en',
        'Europe/Kyiv',
      ),
    ).toBe('18:42 → 20:57');
  });

  test('crossing local midnight shows both dates', () => {
    expect(
      formatRange(
        new Date('2026-11-21T21:50:00Z'),
        new Date('2026-11-21T22:10:00Z'),
        'en',
        'Europe/Kyiv',
      ),
    ).toBe('21 Nov 23:50 → 22 Nov 00:10');
  });
});

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
