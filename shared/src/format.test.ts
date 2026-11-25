import { describe, expect, test } from 'vitest';
import { resources } from './i18n/index.ts';
import { formatDuration, formatMoment, formatRange, type Translate } from './format.ts';

const t: Translate = (key, { value }) => {
  const [, , unit] = key.split('.') as [
    string,
    string,
    keyof typeof resources.en.translation.common.duration,
  ];
  return resources.en.translation.common.duration[unit].replace('{{value}}', String(value));
};

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
    expect(formatDuration(seconds, t)).toBe(expected);
  });
});

describe('formatDuration with seconds', () => {
  test.each([
    [25, '25 s'],
    [60, '1 min'],
    [61, '1 min 1 s'],
    [749, '12 min 29 s'],
    [3599, '59 min 59 s'],
    [3600, '1 h'],
    [8100, '2 h 15 min'],
  ])('%i s is %s', (seconds, expected) => {
    expect(formatDuration(seconds, t, { withSeconds: true })).toBe(expected);
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
