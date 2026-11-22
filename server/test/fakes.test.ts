import { expect, test } from 'vitest';
import { FakeClock } from './fakes.ts';

const start = new Date('2026-11-21T16:42:00Z');

test('returns the start time', () => {
  expect(new FakeClock(start).now()).toEqual(start);
});

test('advance moves the clock', () => {
  const clock = new FakeClock(start);
  clock.advance(1000);
  expect(clock.now()).toEqual(new Date('2026-11-21T16:42:01Z'));
});

test('set jumps to a time', () => {
  const clock = new FakeClock(start);
  clock.set(new Date('2027-01-01T00:00:00Z'));
  expect(clock.now()).toEqual(new Date('2027-01-01T00:00:00Z'));
});

test('now returns a copy', () => {
  const clock = new FakeClock(start);
  clock.now().setTime(0);
  start.setTime(0);
  expect(clock.now()).toEqual(new Date('2026-11-21T16:42:00Z'));
});
