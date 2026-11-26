import { expect, test } from 'vitest';
import { deviceFixture, outageFixture } from '../../test/fixtures.ts';
import { stateStart } from './stateStart.ts';

const lastPing = '2026-11-26T00:07:00Z';
const declared = '2026-11-26T00:09:00Z';

test('an offline device counts from the last check-in of its open outage', () => {
  const device = deviceFixture({
    state: 'OFFLINE',
    state_since: declared,
    open_outage: outageFixture({ started_at: lastPing, ended_at: null, duration_s: null }),
  });
  expect(stateStart(device)).toBe(lastPing);
});

test('other states, or offline without an open outage, use state_since', () => {
  expect(stateStart(deviceFixture({ state: 'ONLINE', state_since: declared }))).toBe(declared);
  expect(
    stateStart(deviceFixture({ state: 'OFFLINE', state_since: declared, open_outage: null })),
  ).toBe(declared);
});
