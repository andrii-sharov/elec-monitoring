import type { ResetReason } from '@elec/shared';
import { describe, expect, test } from 'vitest';
import { planCheckIn, type DeviceSnapshot, type OpenOutage } from './plan.ts';

const T = new Date('2026-11-21T16:42:00Z');
const STATE_SINCE = new Date('2026-11-21T10:00:00Z');
const at = (s: number) => new Date(T.getTime() + s * 1000);

function device(overrides: Partial<DeviceSnapshot> = {}): DeviceSnapshot {
  return {
    state: 'ONLINE',
    stateSince: STATE_SINCE,
    lastSeenAt: T,
    offlineAt: at(120),
    bootId: 'A',
    seq: 5,
    shortOutageThresholdS: 180,
    networkPauseUntil: null,
    ...overrides,
  };
}

const sameBoot = (seq = 6) => ({ bootId: 'A', seq, resetReason: 'POWER_ON' as ResetReason });
const newBoot = (resetReason: ResetReason) => ({ bootId: 'B', seq: 1, resetReason });

const openOutage = (offAlertQueuedAt: Date | null): OpenOutage => ({
  id: 'o1',
  startedAt: T,
  offAlertQueuedAt,
});

describe('duplicates', () => {
  test('same boot and equal seq is a duplicate', () => {
    expect(planCheckIn(device(), null, sameBoot(5), at(30))).toEqual({ action: 'DUPLICATE' });
  });

  test('same boot and lower seq is a duplicate', () => {
    expect(planCheckIn(device(), null, sameBoot(4), at(30))).toEqual({ action: 'DUPLICATE' });
  });
});

test('PENDING goes ONLINE silently', () => {
  const pending = device({
    state: 'PENDING',
    lastSeenAt: null,
    offlineAt: null,
    bootId: null,
    seq: null,
  });
  expect(planCheckIn(pending, null, newBoot('POWER_ON'), at(5))).toEqual({
    action: 'ACCEPT',
    state: 'ONLINE',
    stateSince: at(5),
    event: null,
  });
});

describe('ONLINE', () => {
  test('a regular ping changes nothing', () => {
    expect(planCheckIn(device(), null, sameBoot(), at(30))).toEqual({
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: STATE_SINCE,
      event: null,
    });
  });

  test.each<ResetReason>(['POWER_ON', 'BROWNOUT'])('a new %s boot is a power blip', (reason) => {
    expect(planCheckIn(device(), null, newBoot(reason), at(25))).toEqual({
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: STATE_SINCE,
      event: { type: 'POWER_BLIP', startedAt: T, kind: 'SHORT' },
    });
  });

  test.each<ResetReason>(['SOFTWARE', 'WATCHDOG', 'PANIC', 'UNKNOWN'])(
    'a new %s boot is not a power blip',
    (reason) => {
      const plan = planCheckIn(device(), null, newBoot(reason), at(25));
      expect(plan).toMatchObject({ action: 'ACCEPT', state: 'ONLINE', event: null });
    },
  );

  test('a power boot without a known boot baseline is not a power blip', () => {
    const plan = planCheckIn(
      device({ bootId: null, seq: null }),
      null,
      newBoot('POWER_ON'),
      at(25),
    );
    expect(plan).toMatchObject({ action: 'ACCEPT', event: null });
  });

  test('contact after the offline deadline records a late outage', () => {
    expect(planCheckIn(device(), null, sameBoot(), at(150))).toEqual({
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: at(150),
      event: { type: 'LATE_OUTAGE', startedAt: T, cause: 'NETWORK', kind: 'SHORT' },
    });
  });

  test('a late power boot is a LONG POWER outage, not a blip', () => {
    expect(planCheckIn(device(), null, newBoot('POWER_ON'), at(200))).toMatchObject({
      event: { type: 'LATE_OUTAGE', startedAt: T, cause: 'POWER', kind: 'LONG' },
    });
  });

  test('contact exactly at the deadline is late', () => {
    expect(planCheckIn(device(), null, sameBoot(), at(120))).toMatchObject({
      event: { type: 'LATE_OUTAGE' },
    });
  });

  test('a clock behind last seen gives a zero gap', () => {
    const plan = planCheckIn(device(), null, newBoot('POWER_ON'), at(-5));
    expect(plan).toMatchObject({ event: { type: 'POWER_BLIP', kind: 'SHORT' } });
  });
});

describe('OFFLINE', () => {
  const offline = device({ state: 'OFFLINE', offlineAt: null });

  test('recovery after a queued OFF alert closes the outage with RECOVERY', () => {
    expect(planCheckIn(offline, openOutage(at(120)), sameBoot(), at(300))).toEqual({
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: at(300),
      event: {
        type: 'CLOSE_OUTAGE',
        outageId: 'o1',
        cause: 'NETWORK',
        kind: 'LONG',
        notify: 'RECOVERY',
      },
    });
  });

  test('recovery without an OFF alert sends a SUMMARY', () => {
    expect(planCheckIn(offline, openOutage(null), sameBoot(), at(300))).toMatchObject({
      event: { type: 'CLOSE_OUTAGE', notify: 'SUMMARY' },
    });
  });

  test('a new power boot is a POWER cause', () => {
    expect(planCheckIn(offline, openOutage(null), newBoot('POWER_ON'), at(300))).toMatchObject({
      event: { cause: 'POWER' },
    });
  });

  test('a new software boot is an UNKNOWN cause', () => {
    expect(planCheckIn(offline, openOutage(null), newBoot('SOFTWARE'), at(300))).toMatchObject({
      event: { cause: 'UNKNOWN' },
    });
  });

  test('no open outage just goes ONLINE', () => {
    expect(planCheckIn(offline, null, sameBoot(), at(300))).toEqual({
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: at(300),
      event: null,
    });
  });
});

test('UPDATING stays UPDATING with no event', () => {
  const updating = device({ state: 'UPDATING', offlineAt: null });
  expect(planCheckIn(updating, null, newBoot('POWER_ON'), at(25))).toEqual({
    action: 'ACCEPT',
    state: 'UPDATING',
    stateSince: STATE_SINCE,
    event: null,
  });
});

describe('planned network pause', () => {
  const paused = (overrides: Partial<DeviceSnapshot> = {}) =>
    device({
      state: 'OFFLINE',
      offlineAt: null,
      networkPauseUntil: at(900),
      ...overrides,
    });

  test('the same boot drops a gap that started during the pause', () => {
    expect(planCheckIn(paused(), openOutage(null), sameBoot(), at(180))).toEqual({
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: at(180),
      event: { type: 'DISCARD_OUTAGE', outageId: 'o1' },
    });
  });

  test('a power reset during the pause is still recorded', () => {
    const plan = planCheckIn(paused(), openOutage(null), newBoot('POWER_ON'), at(180));
    expect(plan).toMatchObject({ event: { type: 'CLOSE_OUTAGE', cause: 'POWER' } });
  });

  test('an OFF alert already queued keeps the outage and its recovery', () => {
    const plan = planCheckIn(paused(), openOutage(at(60)), sameBoot(), at(180));
    expect(plan).toMatchObject({
      event: { type: 'CLOSE_OUTAGE', cause: 'NETWORK', notify: 'RECOVERY' },
    });
  });

  test('a gap that started after the pause ended is kept', () => {
    const plan = planCheckIn(
      paused({ networkPauseUntil: T }),
      openOutage(null),
      sameBoot(),
      at(180),
    );
    expect(plan).toMatchObject({ event: { type: 'CLOSE_OUTAGE', cause: 'NETWORK' } });
  });

  test('a return after the pause ended keeps the gap', () => {
    const plan = planCheckIn(
      paused({ networkPauseUntil: at(120) }),
      openOutage(null),
      sameBoot(),
      at(180),
    );
    expect(plan).toMatchObject({ event: { type: 'CLOSE_OUTAGE', cause: 'NETWORK' } });
  });

  test('a late gap with the same boot during the pause records nothing', () => {
    const online = device({ offlineAt: at(40), networkPauseUntil: at(900) });
    expect(planCheckIn(online, null, sameBoot(), at(180))).toEqual({
      action: 'ACCEPT',
      state: 'ONLINE',
      stateSince: STATE_SINCE,
      event: null,
    });
  });
});
