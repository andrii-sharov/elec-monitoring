import { expect, test } from 'vitest';
import { FakeClock } from '../../test/fakes.ts';
import { createPacer } from './pacer.ts';

test('never lets more than 30 takes into any one-second window', async () => {
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const pacer = createPacer({
    ratePerS: 30,
    clock,
    sleep: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
  });
  const times: number[] = [];
  for (let i = 0; i < 90; i++) {
    await pacer.take();
    times.push(clock.now().getTime());
  }
  for (const start of times) {
    expect(times.filter((t) => t >= start && t < start + 1000).length).toBeLessThanOrEqual(30);
  }
  expect(times.at(-1)! - times[0]!).toBeGreaterThanOrEqual(2000);
});

test('concurrent takes reserve distinct slots', async () => {
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const requested: number[] = [];
  const pacer = createPacer({
    ratePerS: 30,
    clock,
    sleep: (ms) => {
      requested.push(ms);
      return Promise.resolve();
    },
  });
  await Promise.all(Array.from({ length: 60 }, () => pacer.take()));
  expect(new Set(requested).size).toBe(59);
  expect(Math.max(...requested)).toBeGreaterThanOrEqual(1900);
});
