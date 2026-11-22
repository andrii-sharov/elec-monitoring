import { describe, expect, test, vi } from 'vitest';
import { silentLogger } from '../../test/fakes.ts';
import { runLoop } from './loop.ts';

const immediate = () => Promise.resolve();

function abortableSleep(_ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

describe('runLoop', () => {
  test('runs the tick until aborted', async () => {
    const controller = new AbortController();
    const tick = vi.fn<() => Promise<void>>(async () => {
      if (tick.mock.calls.length === 3) controller.abort();
    });
    await runLoop({
      intervalMs: 10,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep: immediate,
    });
    expect(tick).toHaveBeenCalledTimes(3);
  });

  test('logs a failing tick and keeps running', async () => {
    const controller = new AbortController();
    const logger = silentLogger();
    const failure = new Error('db blip');
    const tick = vi.fn<() => Promise<void>>(async () => {
      if (tick.mock.calls.length === 1) throw failure;
      controller.abort();
    });
    await runLoop({ intervalMs: 10, tick, signal: controller.signal, logger, sleep: immediate });
    expect(tick).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(failure);
  });

  test('stops during sleep without another tick', async () => {
    const controller = new AbortController();
    const tick = vi.fn<() => Promise<void>>(async () => {});
    const done = runLoop({
      intervalMs: 60_000,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep: abortableSleep,
    });
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1));
    controller.abort();
    await done;
    expect(tick).toHaveBeenCalledTimes(1);
  });

  test('waits for the running tick before resolving', async () => {
    const controller = new AbortController();
    let finishTick!: () => void;
    let tickFinished = false;
    const tick = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finishTick = () => {
            tickFinished = true;
            resolve();
          };
        }),
    );
    let resolved = false;
    const done = runLoop({
      intervalMs: 10,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
      sleep: abortableSleep,
    }).then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1));
    controller.abort();
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    finishTick();
    await done;
    expect(tickFinished).toBe(true);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  test('the default sleep returns when aborted', async () => {
    const controller = new AbortController();
    const tick = vi.fn<() => Promise<void>>(async () => {});
    const done = runLoop({
      intervalMs: 60_000,
      tick,
      signal: controller.signal,
      logger: silentLogger(),
    });
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });
});
