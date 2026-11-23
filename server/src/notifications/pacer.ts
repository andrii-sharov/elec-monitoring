import type { Clock } from '../clock.ts';

export function createPacer(o: {
  ratePerS: number;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
}): { take(): Promise<void> } {
  const intervalMs = Math.ceil(1000 / o.ratePerS);
  let nextFreeMs = Number.NEGATIVE_INFINITY;
  return {
    async take() {
      const nowMs = o.clock.now().getTime();
      const slotMs = Math.max(nowMs, nextFreeMs);
      nextFreeMs = slotMs + intervalMs;
      if (slotMs > nowMs) await o.sleep(slotMs - nowMs);
    },
  };
}
