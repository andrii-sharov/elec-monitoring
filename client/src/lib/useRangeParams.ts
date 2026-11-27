import { useSearchParams } from 'react-router';
import type { LocalDate } from '@elec/shared';
import { parseRange, rangeParams, type Range } from './period';

export function useRangeParams(today: LocalDate) {
  const [params, setParams] = useSearchParams();
  const range = parseRange(params, today);
  const update = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  return {
    params,
    range,
    update,
    setRange: (value: Range) => update(rangeParams(value, today)),
  };
}
