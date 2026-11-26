import { expect, test } from 'vitest';
import { channelFixture } from '../../../test/fixtures.ts';
import { filterChannels, readFilters } from './channelFilters.ts';

const channels = [
  channelFixture({
    id: 'a',
    name: 'Home chat',
    device_ids: ['d1'],
    created_at: '2026-11-01T00:00:00Z',
  }),
  channelFixture({
    id: 'b',
    name: 'Family',
    enabled: false,
    disabled_reason: 'USER',
    device_ids: ['d1', 'd2'],
    created_at: '2026-11-03T00:00:00Z',
  }),
  channelFixture({
    id: 'c',
    name: 'Alerts hook',
    type: 'WEBHOOK',
    enabled: false,
    disabled_reason: 'TOO_MANY_FAILURES',
    created_at: '2026-11-02T00:00:00Z',
  }),
];

const ids = (query: string) =>
  filterChannels(channels, readFilters(new URLSearchParams(query))).map((c) => c.id);

test('sorts by name by default and by newest or most devices', () => {
  expect(ids('')).toEqual(['c', 'b', 'a']);
  expect(ids('sort=newest')).toEqual(['b', 'c', 'a']);
  expect(ids('sort=devices')).toEqual(['b', 'a', 'c']);
});

test('filters by search, type, device and status together', () => {
  expect(ids('q=HOME')).toEqual(['a']);
  expect(ids('type=WEBHOOK')).toEqual(['c']);
  expect(ids('device=d2')).toEqual(['b']);
  expect(ids('status=active')).toEqual(['a']);
  expect(ids('status=off')).toEqual(['b']);
  expect(ids('status=failing')).toEqual(['c']);
  expect(ids('device=d1&status=off')).toEqual(['b']);
  expect(ids('status=nonsense')).toHaveLength(3);
});
