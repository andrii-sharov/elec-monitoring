import { useCallback, useSyncExternalStore } from 'react';

type Clock = { listeners: Set<() => void>; timer?: ReturnType<typeof setTimeout> };

const clocks = new Map<number, Clock>();

function tick(intervalMs: number, clock: Clock) {
  clock.timer = setTimeout(
    () => {
      for (const listener of clock.listeners) listener();
      tick(intervalMs, clock);
    },
    intervalMs - (Date.now() % intervalMs),
  );
}

function subscribe(intervalMs: number, listener: () => void): () => void {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { listeners: new Set() };
    clocks.set(intervalMs, clock);
    tick(intervalMs, clock);
  }
  clock.listeners.add(listener);
  const subscribed = clock;
  return () => {
    subscribed.listeners.delete(listener);
    if (subscribed.listeners.size > 0) return;
    clearTimeout(subscribed.timer);
    clocks.delete(intervalMs);
  };
}

export function useNow(intervalMs: number): number {
  const subscribeToClock = useCallback(
    (listener: () => void) => subscribe(intervalMs, listener),
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribeToClock,
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
  );
}
