import { describe, expect, it } from 'vitest';
import { formatDuration, offMessage, onMessage } from '../src/messages.js';

const MIN = 60_000;

describe('formatDuration', () => {
  it.each([
    [30 * 1000, '<1 min'],
    [1 * MIN, '1 min'],
    [45 * MIN + 59_000, '45 min'],
    [60 * MIN, '1 h 0 min'],
    [135 * MIN, '2 h 15 min'],
    [26 * 60 * MIN + 5 * MIN, '26 h 5 min'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('messages', () => {
  const lastSeen = new Date('2026-11-21T16:42:00Z');

  it('formats OFF with last signal in Kyiv time', () => {
    expect(offMessage(lastSeen)).toBe('🔴 Power is OFF\nLast signal: 21 Nov 18:42');
  });

  it('formats ON with duration and range', () => {
    const back = new Date(lastSeen.getTime() + 135 * MIN);
    expect(onMessage(lastSeen, back)).toBe(
      '🟢 Power is ON\nWas off for 2 h 15 min (18:42 → 20:57)',
    );
  });
});
