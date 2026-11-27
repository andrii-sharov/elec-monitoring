import { localDate, type StatsBucketKind } from '@elec/shared';
import type { StatsBucket } from '@elec/shared/api';
import type { Formatters } from '@/lib/format';

export type BucketLabels = { axis(bucket: StatsBucket): string; full(bucket: StatsBucket): string };

export function bucketLabels(kind: StatsBucketKind, format: Formatters): BucketLabels {
  const date = (bucket: StatsBucket) => localDate(Date.parse(bucket.from), format.timezone);
  switch (kind) {
    case 'HOUR':
      return {
        axis: (bucket) => format.time(bucket.from).slice(0, 2),
        full: (bucket) => `${format.time(bucket.from)}–${format.time(bucket.to)}`,
      };
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
