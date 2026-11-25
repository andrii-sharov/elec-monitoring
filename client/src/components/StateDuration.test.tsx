import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderInApp } from '../../test/render.tsx';
import { StateDuration } from './StateDuration.tsx';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('online shows how long the power has been on and ticks every minute', async () => {
  renderInApp(<StateDuration state="ONLINE" since="2026-11-21T15:30:00Z" />);
  expect(await screen.findByText('Power on for 3 h 12 min')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByText('Power on for 3 h 13 min')).toBeInTheDocument();
});

test('under a minute it shows seconds and ticks every second', async () => {
  renderInApp(<StateDuration state="ONLINE" since="2026-11-21T18:41:30Z" />);
  expect(await screen.findByText('Power on for 30 s')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText('Power on for 31 s')).toBeInTheDocument();
});

test('from a minute on it drops the seconds', async () => {
  renderInApp(<StateDuration state="ONLINE" since="2026-11-21T18:29:30Z" />);
  expect(await screen.findByText('Power on for 12 min')).toBeInTheDocument();
});

test('offline shows how long there has been no contact', async () => {
  renderInApp(<StateDuration state="OFFLINE" since="2026-11-21T18:17:00Z" />);
  expect(await screen.findByText('No contact for 25 min')).toBeInTheDocument();
});

test('pending waits for the first check-in', async () => {
  renderInApp(<StateDuration state="PENDING" since="2026-11-21T18:17:00Z" />);
  expect(await screen.findByText('Waiting for the first check-in')).toBeInTheDocument();
});
