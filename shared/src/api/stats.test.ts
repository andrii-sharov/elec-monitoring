import { expect, test } from 'vitest';
import { statsQuerySchema, statsSchema } from './stats.ts';

function issuePaths(input: unknown): string[] {
  const result = statsQuerySchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

test.each([
  [{ period: 'CUSTOM', from: '2026-01-01' }, 'to'],
  [{ period: 'CUSTOM', to: '2026-01-01' }, 'from'],
  [{ period: 'CUSTOM', from: '2026-01-01', to: '2027-01-02' }, 'to'],
  [{ period: 'CUSTOM', from: '2026-02-01', to: '2026-01-01' }, 'to'],
  [{ period: 'WEEK', from: '2026-11-23', to: '2026-11-29' }, 'to'],
  [{ period: 'WEEK', from: '2026-02-30' }, 'from'],
  [{ period: 'DAY', from: '1999-12-31' }, 'from'],
  [{ period: 'DAY', from: '2101-01-01' }, 'from'],
  [{ period: 'HOUR' }, 'period'],
])('rejects %o at %s', (input, path) => {
  expect(issuePaths(input)).toContain(path);
});

test.each([
  { period: 'DAY' },
  { period: 'YEAR', from: '2026-06-01' },
  { period: 'CUSTOM', from: '2026-01-01', to: '2026-12-31' },
  { period: 'CUSTOM', from: '2024-01-01', to: '2024-12-31' },
])('accepts %o', (input) => {
  expect(statsQuerySchema.safeParse(input).success).toBe(true);
});

test('parses the documented response', () => {
  const bucket = {
    from: '2026-11-15T22:00:00Z',
    to: '2026-11-16T22:00:00Z',
    outages: 1,
    power_blips: 0,
    total_downtime_s: 3600,
    availability_pct: null,
  };
  const body = {
    period: 'WEEK',
    timezone: 'Europe/Kyiv',
    from: '2026-11-15T22:00:00Z',
    to: '2026-11-22T22:00:00Z',
    bucket: 'DAY',
    monitoring_since: null,
    outages: 7,
    long_outages: 3,
    open_outage: false,
    power_blips: 2,
    by_cause: { power: 5, network: 1, unknown: 1 },
    total_downtime_s: 28800,
    avg_outage_s: 4114,
    longest_outage_s: 14400,
    availability_pct: 95.24,
    buckets: [bucket],
  };
  expect(statsSchema.parse(body)).toEqual(body);
});
