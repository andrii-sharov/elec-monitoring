import { describe, expect, test } from 'vitest';
import { notificationEvent, offAlertDueAt } from './rules.ts';

const allOn = { notifyShortOutages: true, notifyNetworkOutages: true };
const allOff = { notifyShortOutages: false, notifyNetworkOutages: false };

describe('notificationEvent', () => {
  test('OFF alert always notifies', () => {
    expect(notificationEvent('offAlert', { kind: null, cause: null }, allOff)).toBe(
      'device.offline',
    );
  });

  test('recovery always notifies, even with both rules off', () => {
    expect(notificationEvent('recovery', { kind: 'SHORT', cause: 'NETWORK' }, allOff)).toBe(
      'device.online',
    );
  });

  test.each([
    ['SHORT', 'UNKNOWN', { ...allOn, notifyShortOutages: false }, null],
    ['LONG', 'UNKNOWN', { ...allOn, notifyShortOutages: false }, 'device.online'],
    ['LONG', 'NETWORK', { ...allOn, notifyNetworkOutages: false }, null],
    ['LONG', 'POWER', { ...allOn, notifyNetworkOutages: false }, 'device.online'],
    ['LONG', 'NETWORK', allOn, 'device.online'],
  ] as const)('summary %s %s', (kind, cause, rules, expected) => {
    expect(notificationEvent('summary', { kind, cause }, rules)).toBe(expected);
  });

  test.each([
    ['SHORT', { ...allOn, notifyShortOutages: false }, null],
    ['LONG', { ...allOn, notifyShortOutages: false }, 'device.power_blip'],
    ['SHORT', allOn, 'device.power_blip'],
  ] as const)('power blip %s', (kind, rules, expected) => {
    expect(notificationEvent('powerBlip', { kind, cause: 'POWER' }, rules)).toBe(expected);
  });
});

describe('offAlertDueAt', () => {
  const T = new Date('2026-11-21T16:42:00Z');
  const at = (s: number) => new Date(T.getTime() + s * 1000);

  test('waits for the end of a network pause', () => {
    expect(
      offAlertDueAt(T, at(120), {
        notifyShortOutages: true,
        shortOutageThresholdS: 180,
        networkPauseUntil: at(600),
      }),
    ).toEqual(at(600));
  });

  test('ignores a pause that already ended', () => {
    expect(
      offAlertDueAt(T, at(120), {
        notifyShortOutages: true,
        shortOutageThresholdS: 180,
        networkPauseUntil: at(60),
      }),
    ).toEqual(at(120));
  });

  test('is now when short outages notify', () => {
    expect(
      offAlertDueAt(T, at(120), {
        notifyShortOutages: true,
        shortOutageThresholdS: 180,
        networkPauseUntil: null,
      }),
    ).toEqual(at(120));
  });

  test('waits for the short-outage threshold when they do not', () => {
    expect(
      offAlertDueAt(T, at(120), {
        notifyShortOutages: false,
        shortOutageThresholdS: 180,
        networkPauseUntil: null,
      }),
    ).toEqual(at(180));
  });

  test('is never in the past', () => {
    expect(
      offAlertDueAt(T, at(120), {
        notifyShortOutages: false,
        shortOutageThresholdS: 60,
        networkPauseUntil: null,
      }),
    ).toEqual(at(120));
  });
});
