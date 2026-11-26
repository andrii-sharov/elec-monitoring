import { expect, test } from 'vitest';
import {
  monthChunks,
  parseRange,
  periodRange,
  rangeParams,
  shiftRange,
  type Range,
} from './period.ts';

const today = '2026-11-26';
const params = (query: string) => new URLSearchParams(query);

test('builds each period around an anchor day', () => {
  expect(periodRange('day', '2026-11-26')).toEqual({
    period: 'day',
    from: '2026-11-26',
    to: '2026-11-26',
  });
  expect(periodRange('week', '2026-11-26')).toMatchObject({ from: '2026-11-23', to: '2026-11-29' });
  expect(periodRange('month', '2026-02-10')).toMatchObject({
    from: '2026-02-01',
    to: '2026-02-28',
  });
  expect(periodRange('month', '2028-02-10')).toMatchObject({ to: '2028-02-29' });
  expect(periodRange('year', '2026-11-26')).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
});

test('moves by one period', () => {
  expect(shiftRange(periodRange('month', '2026-01-15'), -1)).toMatchObject({
    from: '2025-12-01',
    to: '2025-12-31',
  });
  expect(shiftRange(periodRange('week', today), 1)).toMatchObject({ from: '2026-11-30' });
  const custom: Range = { period: 'custom', from: '2026-11-01', to: '2026-11-10' };
  expect(shiftRange(custom, -1)).toEqual({
    period: 'custom',
    from: '2026-10-22',
    to: '2026-10-31',
  });
  expect(shiftRange(periodRange('year', today), -1)).toMatchObject({
    from: '2025-01-01',
    to: '2025-12-31',
  });
});

test('reads the range from the URL, falling back safely', () => {
  expect(parseRange(params(''), today)).toMatchObject({ period: 'week', from: '2026-11-23' });
  expect(parseRange(params('period=month&from=2026-03-09'), today)).toMatchObject({
    from: '2026-03-01',
    to: '2026-03-31',
  });
  expect(parseRange(params('week=2026-11-09'), today)).toMatchObject({
    period: 'week',
    from: '2026-11-09',
  });
  expect(parseRange(params('period=day&from=2027-01-01'), today)).toMatchObject({ from: today });
  expect(parseRange(params('period=custom&from=2026-11-10&to=2026-11-01'), today)).toMatchObject({
    period: 'week',
  });
  expect(parseRange(params('period=custom&from=2025-01-01&to=2026-11-01'), today)).toEqual({
    period: 'custom',
    from: '2025-01-01',
    to: '2026-01-01',
  });
  expect(parseRange(params('period=nonsense&from=bad'), today)).toMatchObject({
    period: 'week',
    from: '2026-11-23',
  });
});

test('writes short URLs for the current period', () => {
  expect(rangeParams(periodRange('week', today), today)).toEqual({
    period: null,
    from: null,
    to: null,
    week: null,
  });
  expect(rangeParams(periodRange('month', '2026-03-03'), today)).toEqual({
    period: 'month',
    from: '2026-03-01',
    to: null,
    week: null,
  });
});

test('splits long ranges into month chunks', () => {
  expect(monthChunks({ period: 'custom', from: '2026-01-20', to: '2026-03-05' })).toEqual([
    { from: '2026-01-20', to: '2026-01-31' },
    { from: '2026-02-01', to: '2026-02-28' },
    { from: '2026-03-01', to: '2026-03-05' },
  ]);
});
