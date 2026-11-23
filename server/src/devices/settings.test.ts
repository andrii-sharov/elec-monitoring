import { describe, expect, test } from 'vitest';
import type { DeviceRow } from './access.ts';
import { applySettingsPatch, settingsPatchSchema } from './settings.ts';

const LAST_SEEN = new Date('2026-11-21T16:40:20Z');

function row(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: 'd1',
    ownerId: 'u1',
    name: 'Home',
    tokenHash: null,
    pairingCodeHash: null,
    pairingCodeExpiresAt: null,
    claimedAt: null,
    state: 'PENDING',
    stateSince: LAST_SEEN,
    lastSeenAt: null,
    offlineAt: null,
    bootId: null,
    seq: null,
    uptimeS: null,
    rssi: null,
    fwVersion: null,
    pingIntervalS: 30,
    previousPingIntervalS: null,
    offlineTimeoutS: 120,
    shortOutageThresholdS: 180,
    notifyShortOutages: true,
    notifyNetworkOutages: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    autoUpdate: false,
    settingsVersion: 1,
    appliedSettingsVersion: null,
    createdAt: LAST_SEEN,
    updatedAt: LAST_SEEN,
    ...overrides,
  };
}

const online = (overrides: Partial<DeviceRow> = {}) =>
  row({
    state: 'ONLINE',
    lastSeenAt: LAST_SEEN,
    offlineAt: new Date(LAST_SEEN.getTime() + 120_000),
    ...overrides,
  });

function changesOf(result: ReturnType<typeof applySettingsPatch>) {
  if ('error' in result) throw new Error(`unexpected error ${JSON.stringify(result.error)}`);
  return result.changes;
}

describe('ping interval', () => {
  test('a new interval bumps the version and keeps the old interval', () => {
    expect(changesOf(applySettingsPatch(row(), { ping_interval_s: 60 }))).toMatchObject({
      pingIntervalS: 60,
      settingsVersion: 2,
      previousPingIntervalS: 30,
    });
  });

  test('the same interval does not bump the version', () => {
    const changes = changesOf(applySettingsPatch(row(), { ping_interval_s: 30 }));
    expect(changes).not.toHaveProperty('settingsVersion');
    expect(changes).not.toHaveProperty('previousPingIntervalS');
  });

  test('a second change keeps the larger unapplied interval', () => {
    const first = row({
      pingIntervalS: 60,
      previousPingIntervalS: 30,
      settingsVersion: 2,
      offlineTimeoutS: 120,
    });
    expect(changesOf(applySettingsPatch(first, { ping_interval_s: 15 }))).toMatchObject({
      pingIntervalS: 15,
      previousPingIntervalS: 60,
      settingsVersion: 3,
    });
  });
});

describe('cross-field validation', () => {
  test('rejects an interval too long for the timeout', () => {
    expect(applySettingsPatch(row(), { ping_interval_s: 90 })).toEqual({
      error: { path: 'settings.offline_timeout_s', code: 'too_small', min: 180 },
    });
  });

  test('accepts the interval with a matching timeout', () => {
    expect(
      changesOf(applySettingsPatch(row(), { ping_interval_s: 90, offline_timeout_s: 180 })),
    ).toMatchObject({
      pingIntervalS: 90,
      offlineTimeoutS: 180,
    });
  });
});

describe('offline deadline', () => {
  test('lowering the timeout on an ONLINE device moves offline_at at once', () => {
    const changes = changesOf(
      applySettingsPatch(online({ offlineTimeoutS: 600 }), { offline_timeout_s: 60 }),
    );
    expect(changes.offlineAt).toEqual(new Date(LAST_SEEN.getTime() + 60_000));
  });

  test('a shorter interval keeps the previous interval allowance', () => {
    const changes = changesOf(
      applySettingsPatch(online(), { ping_interval_s: 15, offline_timeout_s: 30 }),
    );
    expect(changes.offlineAt).toEqual(new Date(LAST_SEEN.getTime() + 60_000));
  });

  test('a PENDING device gets no offline_at', () => {
    expect(changesOf(applySettingsPatch(row(), { offline_timeout_s: 300 }))).not.toHaveProperty(
      'offlineAt',
    );
  });
});

describe('quiet hours', () => {
  test('sets both ends', () => {
    expect(
      changesOf(applySettingsPatch(row(), { quiet_hours: { start: '23:00', end: '07:00' } })),
    ).toMatchObject({
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
    });
  });

  test('null clears both ends', () => {
    const current = row({ quietHoursStart: '23:00:00', quietHoursEnd: '07:00:00' });
    expect(changesOf(applySettingsPatch(current, { quiet_hours: null }))).toMatchObject({
      quietHoursStart: null,
      quietHoursEnd: null,
    });
  });

  test.each([
    { start: '23:00', end: '23:00' },
    { start: '24:00', end: '07:00' },
    { start: '7:00', end: '08:00' },
  ])('schema rejects %j', (quiet_hours) => {
    expect(settingsPatchSchema.safeParse({ quiet_hours }).success).toBe(false);
  });
});

describe('schema ranges', () => {
  test.each([
    { ping_interval_s: 14 },
    { ping_interval_s: 601 },
    { offline_timeout_s: 29 },
    { offline_timeout_s: 3601 },
    { short_outage_threshold_s: 29 },
    { short_outage_threshold_s: 86_401 },
    { ping_interval_s: 30.5 },
    { unknown: true },
  ])('rejects %j', (body) => {
    expect(settingsPatchSchema.safeParse(body).success).toBe(false);
  });
});
