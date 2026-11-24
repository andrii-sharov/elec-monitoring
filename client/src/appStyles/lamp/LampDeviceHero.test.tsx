import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderInApp } from '../../../test/render.tsx';
import { LampDeviceHero } from './LampDeviceHero';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('an online device reads as one sentence about the power', async () => {
  renderInApp(
    <LampDeviceHero
      device={deviceFixture({ state: 'ONLINE', state_since: '2026-11-21T15:30:00Z' })}
    />,
    { me: meFixture() },
  );
  expect(
    await screen.findByRole('heading', { name: 'The power is on at Home, 3 h 12 min now' }),
  ).toBeInTheDocument();
});

test('an offline device reads as lost contact, not as power off', async () => {
  renderInApp(
    <LampDeviceHero
      device={deviceFixture({
        name: 'Garage',
        state: 'OFFLINE',
        state_since: '2026-11-21T18:17:00Z',
      })}
    />,
    { me: meFixture() },
  );
  expect(
    await screen.findByRole('heading', { name: 'No contact with Garage for 25 min' }),
  ).toBeInTheDocument();
});
