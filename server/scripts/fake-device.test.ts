import { describe, expect, test } from 'vitest';
import { nextBoot, nextPing, type FakeState } from './fake-device.ts';

const NOW = new Date('2026-11-21T16:42:00Z');

const claimed: FakeState = {
  api: 'http://localhost:3000',
  deviceId: 'd1',
  token: 'a'.repeat(64),
  bootId: null,
  seq: 0,
  bootStartedAt: null,
  nextEventId: 1,
};

describe('nextBoot', () => {
  test('starts a new boot with seq 1', () => {
    const { state, body } = nextBoot(claimed, 'POWER_ON', NOW);
    expect(state.bootId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state).toMatchObject({ seq: 1, bootStartedAt: NOW.toISOString() });
    expect(body).toMatchObject({
      type: 'BOOT',
      boot_id: state.bootId,
      seq: 1,
      uptime_s: 0,
      reset_reason: 'POWER_ON',
    });
    expect(nextBoot(state, 'SOFTWARE', NOW).state.bootId).not.toBe(state.bootId);
  });
});

describe('nextPing', () => {
  const booted = nextBoot(claimed, 'POWER_ON', new Date(NOW.getTime() - 300_000)).state;

  test('increments seq and reports uptime since boot', () => {
    const { state, body } = nextPing(booted, NOW);
    expect(state.seq).toBe(2);
    expect(body).toMatchObject({ type: 'PING', boot_id: booted.bootId, seq: 2, uptime_s: 300 });
    expect(body).not.toHaveProperty('wifi');
  });

  test('adds a Wi-Fi drop that ended 5 s ago', () => {
    const { state, body } = nextPing(booted, NOW, 40);
    expect(body).toMatchObject({
      wifi: {
        evicted: 0,
        events: [{ id: 1, kind: 'WIFI', start_uptime_s: 255, end_uptime_s: 295, reason: 201 }],
      },
    });
    expect(state.nextEventId).toBe(2);
  });

  test('needs a boot first', () => {
    expect(() => nextPing(claimed, NOW)).toThrow(/boot/);
  });
});
