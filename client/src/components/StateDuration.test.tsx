import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SessionProvider } from '@/api/session';
import { createClientI18n } from '@/lib/i18n';
import { StateDuration } from './StateDuration.tsx';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server.ts';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
  server.use(
    http.post('http://localhost:3000/api/auth/refresh', () =>
      HttpResponse.json({ error: { code: 'unauthorized', message: 'x' } }, { status: 401 }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function renderWithApp(node: ReactNode) {
  const router = createMemoryRouter(
    [{ path: '/', element: <SessionProvider>{node}</SessionProvider> }],
    { initialEntries: ['/'] },
  );
  render(
    <I18nextProvider i18n={createClientI18n('en')}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

test('online shows how long the power has been on and keeps ticking', async () => {
  renderWithApp(<StateDuration state="ONLINE" since="2026-11-21T15:30:00Z" />);
  expect(await screen.findByText('Power on for 3 h 12 min')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByText('Power on for 3 h 12 min')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByText('Power on for 3 h 13 min')).toBeInTheDocument();
});

test('offline shows how long there has been no contact', async () => {
  renderWithApp(<StateDuration state="OFFLINE" since="2026-11-21T18:17:00Z" />);
  expect(await screen.findByText('No contact for 25 min')).toBeInTheDocument();
});

test('pending waits for the first check-in', async () => {
  renderWithApp(<StateDuration state="PENDING" since="2026-11-21T18:17:00Z" />);
  expect(await screen.findByText('Waiting for the first check-in')).toBeInTheDocument();
});
