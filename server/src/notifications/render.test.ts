import { describe, expect, test } from 'vitest';
import { createI18n } from '../i18n.ts';
import type { OutageItem } from '../http/devices/views.ts';
import { renderDeliveryText, type DeliveryPayload } from './render.ts';

const i18n = createI18n();

function outage(overrides: Partial<OutageItem> = {}): OutageItem {
  return {
    id: 'o1',
    type: 'OUTAGE',
    started_at: '2026-11-21T16:42:00.000Z',
    ended_at: null,
    duration_s: null,
    cause: null,
    kind: null,
    ota_attempt_id: null,
    ...overrides,
  };
}

function payload(
  event: DeliveryPayload['event'],
  item: OutageItem,
  name = 'Home',
): DeliveryPayload {
  return { event, device: { id: 'd1', name }, outage: item };
}

const base = { offAlertQueued: true, language: 'en' as const, timezone: 'Europe/Kyiv' };

describe('renderDeliveryText', () => {
  test('offline', () => {
    expect(
      renderDeliveryText(i18n, { ...base, payload: payload('device.offline', outage()) }),
    ).toBe('🔴 Home — device stopped checking in\nLast signal: 21 Nov 18:42');
  });

  test('recovery after an OFF alert with a power cause', () => {
    const item = outage({
      ended_at: '2026-11-21T18:57:00.000Z',
      duration_s: 8100,
      cause: 'POWER',
      kind: 'LONG',
    });
    expect(renderDeliveryText(i18n, { ...base, payload: payload('device.online', item) })).toBe(
      '🟢 Home — device is back online\nOffline for 2 h 15 min (18:42 → 20:57) · suspected power outage',
    );
  });

  test('summary when no OFF alert was queued', () => {
    const item = outage({
      ended_at: '2026-11-21T16:44:30.000Z',
      duration_s: 150,
      cause: 'NETWORK',
      kind: 'SHORT',
    });
    expect(
      renderDeliveryText(i18n, {
        ...base,
        offAlertQueued: false,
        payload: payload('device.online', item),
      }),
    ).toBe(
      '🟠 Home — device was out of contact\nOffline for 2 min (18:42 → 18:44) · suspected network outage',
    );
  });

  test('unknown cause has no suffix', () => {
    const item = outage({
      ended_at: '2026-11-21T16:44:30.000Z',
      duration_s: 150,
      cause: 'UNKNOWN',
      kind: 'SHORT',
    });
    expect(renderDeliveryText(i18n, { ...base, payload: payload('device.online', item) })).toBe(
      '🟢 Home — device is back online\nOffline for 2 min (18:42 → 18:44)',
    );
  });

  test('short power blip', () => {
    const item = outage({
      type: 'POWER_BLIP',
      ended_at: '2026-11-21T16:42:25.000Z',
      duration_s: 25,
      cause: 'POWER',
      kind: 'SHORT',
    });
    expect(renderDeliveryText(i18n, { ...base, payload: payload('device.power_blip', item) })).toBe(
      '🟡 Home — suspected short power interruption\nDevice restarted · 25 s between check-ins',
    );
  });

  test('long power blip drops "short" from the title', () => {
    const item = outage({
      type: 'POWER_BLIP',
      ended_at: '2026-11-21T16:46:00.000Z',
      duration_s: 240,
      cause: 'POWER',
      kind: 'LONG',
    });
    expect(
      renderDeliveryText(i18n, { ...base, payload: payload('device.power_blip', item) }).split(
        '\n',
      )[0],
    ).toBe('🟡 Home — suspected power interruption');
  });

  test.each(['uk', 'ru'] as const)('%s text differs from en and keeps the name', (language) => {
    const input = { ...base, language, payload: payload('device.offline', outage()) };
    const text = renderDeliveryText(i18n, input);
    expect(text).not.toBe(renderDeliveryText(i18n, { ...input, language: 'en' }));
    expect(text).toContain('Home');
  });

  test.each(['<b>&amp; 💡', 'x'.repeat(64)])('device name %s is kept as-is', (name) => {
    const text = renderDeliveryText(i18n, {
      ...base,
      payload: payload('device.offline', outage(), name),
    });
    expect(text).toContain(`${name} —`);
  });
});
