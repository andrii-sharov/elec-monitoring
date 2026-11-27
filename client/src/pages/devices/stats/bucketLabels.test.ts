import { formatTime, type StatsBucketKind } from '@elec/shared';
import type { StatsBucket } from '@elec/shared/api';
import { expect, test } from 'vitest';
import type { Formatters } from '@/lib/format';
import { bucketLabels } from './bucketLabels';

const berlin = 'Europe/Berlin';
const formatters = {
  timezone: berlin,
  time: (iso: string) => formatTime(new Date(iso), 'en', berlin),
} as Formatters;

function hours(fromIso: string, count: number): StatsBucket[] {
  return Array.from({ length: count }, (_hour, index) => {
    const from = Date.parse(fromIso) + index * 3_600_000;
    return {
      from: new Date(from).toISOString(),
      to: new Date(from + 3_600_000).toISOString(),
      outages: 0,
      power_blips: 0,
      total_downtime_s: 0,
      network_downtime_s: 0,
      availability_pct: 100,
    };
  });
}

const labelsFor = (kind: StatsBucketKind, buckets: StatsBucket[]) =>
  buckets.map(bucketLabels(kind, formatters, buckets).full);

test('the repeated hour on the autumn DST day shows each offset', () => {
  const labels = labelsFor('HOUR', hours('2026-10-24T22:00:00Z', 25));
  expect(labels.slice(1, 4)).toEqual(['01:00–02:00', '02:00–03:00 (GMT+2)', '02:00–03:00 (GMT+1)']);
  expect(labels[4]).toBe('03:00–04:00');
  expect(labels.at(-1)).toBe('23:00–00:00');
});

test('the spring DST day skips 02:00 without offsets', () => {
  const labels = labelsFor('HOUR', hours('2026-03-28T23:00:00Z', 23));
  expect(labels.slice(1, 3)).toEqual(['01:00–03:00', '03:00–04:00']);
  expect(labels.every((label) => !label.includes('GMT'))).toBe(true);
});
