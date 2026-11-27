import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderInApp } from '../../../test/render.tsx';
import { PowerCard } from './PowerCard.tsx';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-11-21T18:42:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

test('an online device fills the card with signal and a live duration', async () => {
  const device = deviceFixture({ state: 'ONLINE', state_since: '2026-11-21T15:00:00Z' });
  renderInApp(<PowerCard device={device} />, { me: meFixture() });
  const card = await screen.findByRole('region', { name: 'Power on' });
  expect(card).toHaveClass('bg-signal');
  expect(within(card).getByText('3 h 42 min')).toBeInTheDocument();
  expect(within(card).getByText(/since 21 Nov 17:00/)).toBeInTheDocument();
  expect(within(card).getByText('Home', { exact: false })).toBeInTheDocument();
});

test('an offline device keeps a surface card with a coral edge', async () => {
  const device = deviceFixture({
    state: 'OFFLINE',
    state_since: '2026-11-21T18:30:00Z',
    last_seen_at: '2026-11-21T18:30:00Z',
  });
  renderInApp(<PowerCard device={device} />, { me: meFixture() });
  const card = await screen.findByRole('region', { name: 'No contact' });
  expect(card).not.toHaveClass('bg-signal');
  expect(card).toHaveClass('ring-status-offline');
  expect(within(card).getByText('12 min')).toBeInTheDocument();
});

test('a pending device waits for its first check-in without a duration', async () => {
  const device = deviceFixture({ state: 'PENDING', last_seen_at: null });
  renderInApp(<PowerCard device={device} />, { me: meFixture() });
  const card = await screen.findByRole('region', { name: 'Waiting' });
  expect(within(card).getByText('Waiting for the first check-in')).toBeInTheDocument();
  expect(within(card).queryByText(/since/)).toBeNull();
});
