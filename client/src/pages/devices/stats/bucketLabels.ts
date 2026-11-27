import { localDate, type StatsBucketKind } from '@elec/shared';
import type { StatsBucket } from '@elec/shared/api';
import type { Formatters } from '@/lib/format';

export type BucketLabels = { axis(bucket: StatsBucket): string; full(bucket: StatsBucket): string };

function offsetOf(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(Date.parse(iso));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

function nextHour(time: string): string {
  return `${String((Number(time.slice(0, 2)) + 1) % 24).padStart(2, '0')}:00`;
}

function hourLabels(format: Formatters, buckets: StatsBucket[]): BucketLabels {
  const starts = buckets.map((bucket) => format.time(bucket.from));
  const repeated = new Set(starts.filter((start, index) => starts.indexOf(start) !== index));
  return {
    axis: (bucket) => format.time(bucket.from).slice(0, 2),
    full: (bucket) => {
      const start = format.time(bucket.from);
      if (!repeated.has(start)) return `${start}–${format.time(bucket.to)}`;
      return `${start}–${nextHour(start)} (${offsetOf(bucket.from, format.timezone)})`;
    },
  };
}

export function bucketLabels(
  kind: StatsBucketKind,
  format: Formatters,
  buckets: StatsBucket[],
): BucketLabels {
  const date = (bucket: StatsBucket) => localDate(Date.parse(bucket.from), format.timezone);
  switch (kind) {
    case 'HOUR':
      return hourLabels(format, buckets);
    case 'DAY':
      return {
        axis: (bucket) => format.day(date(bucket), { day: 'numeric' }),
        full: (bucket) =>
          format.day(date(bucket), { weekday: 'short', day: 'numeric', month: 'short' }),
      };
    case 'MONTH':
      return {
        axis: (bucket) => format.day(date(bucket), { month: 'short' }),
        full: (bucket) => format.day(date(bucket), { month: 'long', year: 'numeric' }),
      };
  }
}
