import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from '../logger.ts';

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const defaultSleep: Sleep = (ms, signal) =>
  delay(ms, undefined, { signal }).catch((err: unknown) => {
    if (!signal.aborted) throw err;
  });

export async function runLoop(opts: {
  intervalMs: number;
  tick: () => Promise<void>;
  signal: AbortSignal;
  logger: Logger;
  sleep?: Sleep;
}): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  while (!opts.signal.aborted) {
    try {
      await opts.tick();
    } catch (err) {
      opts.logger.error(err);
    }
    if (opts.signal.aborted) break;
    await sleep(opts.intervalMs, opts.signal);
  }
}
