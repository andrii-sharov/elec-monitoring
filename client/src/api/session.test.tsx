import { useQueries, QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router';
import { expect, test } from 'vitest';
import { AppProviders } from '../app/providers.tsx';
import { createClientI18n } from '../lib/i18n.ts';
import { meFixture, sessionFixture } from '../../test/fixtures.ts';
import { renderRoute } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { queryKeys } from './queries.ts';
import { RequireAnon, RequireAuth, SessionProvider, useSession } from './session.tsx';

const base = 'http://localhost:3000';
const session = sessionFixture({ access_token: 'token-1', user: meFixture({ name: 'Johnny' }) });

function unauthorized() {
  return HttpResponse.json(
    { error: { code: 'unauthorized', message: 'Unauthorized' } },
    { status: 401 },
  );
}

function refreshHandler(answers: (() => Response | Promise<Response>)[]) {
  const calls = { count: 0 };
  server.use(
    http.post(`${base}/api/auth/refresh`, () => {
      const answer = answers[Math.min(calls.count, answers.length - 1)];
      calls.count += 1;
      return answer ? answer() : unauthorized();
    }),
  );
  return calls;
}

function Probe() {
  const { status, me } = useSession();
  return <p data-testid="probe">{`${status}:${me?.name ?? ''}`}</p>;
}

function Controls() {
  const { signedIn, signOut } = useSession();
  return (
    <>
      <Probe />
      <button type="button" onClick={() => signedIn(session)}>
        sign in
      </button>
      <button type="button" onClick={() => void signOut()}>
        sign out
      </button>
    </>
  );
}

function FourQueries() {
  const { api } = useSession();
  useQueries({
    queries: ['a', 'b', 'c', 'd'].map((key) => ({
      queryKey: ['parallel', key],
      queryFn: () => api.request('/api/v1/devices'),
    })),
  });
  return <p>device page</p>;
}

function mount(children: RouteObject[], path: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <SessionProvider>
            <Outlet />
          </SessionProvider>
        ),
        children,
      },
    ],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <StrictMode>
      <AppProviders i18n={createClientI18n('en')} queryClient={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
  return { router, queryClient };
}

function location(router: { state: { location: { pathname: string; search: string } } }) {
  return router.state.location.pathname + router.state.location.search;
}

function recordNavigations(router: ReturnType<typeof createMemoryRouter>) {
  const visited: string[] = [];
  let lastKey = router.state.location.key;
  const unsubscribe = router.subscribe((state) => {
    if (state.location.key === lastKey) return;
    lastKey = state.location.key;
    visited.push(state.location.pathname + state.location.search);
  });
  return { visited, unsubscribe };
}

test('on load the provider refreshes once under StrictMode and becomes authenticated', async () => {
  const refresh = refreshHandler([
    async () => {
      await delay(20);
      return HttpResponse.json(session);
    },
  ]);
  const { queryClient } = mount([{ path: '*', Component: Probe }], '/');

  expect(screen.getByTestId('probe')).toHaveTextContent('loading:');
  await waitFor(() =>
    expect(screen.getByTestId('probe')).toHaveTextContent('authenticated:Johnny'),
  );
  expect(refresh.count).toBe(1);
  expect(queryClient.getQueryData(queryKeys.me)).toEqual(session.user);
});

test('on load a refresh 401 makes the session anonymous', async () => {
  const refresh = refreshHandler([unauthorized]);
  mount([{ path: '*', Component: Probe }], '/');

  await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('anonymous:'));
  expect(refresh.count).toBe(1);
});

test('on load a refresh 409 then 200 signs in without a second session', async () => {
  const refresh = refreshHandler([
    () => HttpResponse.json({ error: { code: 'conflict', message: 'Retry' } }, { status: 409 }),
    () => HttpResponse.json(session),
  ]);
  mount([{ path: '*', Component: Probe }], '/');

  await waitFor(() =>
    expect(screen.getByTestId('probe')).toHaveTextContent('authenticated:Johnny'),
  );
  expect(refresh.count).toBe(2);
});

test('RequireAuth shows a loading state, then redirects anonymous users with next', async () => {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  refreshHandler([
    async () => {
      await released;
      return unauthorized();
    },
  ]);
  const { router } = mount(
    [
      { path: 'login', element: <p>login page</p> },
      { Component: RequireAuth, children: [{ path: 'devices/:id', element: <p>device page</p> }] },
    ],
    '/devices/d1?tab=history',
  );
  const { visited, unsubscribe } = recordNavigations(router);

  expect(await screen.findByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  release();
  expect(await screen.findByText('login page')).toBeInTheDocument();
  await delay(50);
  unsubscribe();
  expect(visited).toEqual(['/login?next=%2Fdevices%2Fd1%3Ftab%3Dhistory']);
});

test('a lost session while four queries are in flight refreshes once and redirects once', async () => {
  const refresh = refreshHandler([() => HttpResponse.json(session), unauthorized]);
  server.use(http.get(`${base}/api/v1/devices`, unauthorized));
  const { router } = mount(
    [
      { path: 'login', element: <p>login page</p> },
      { Component: RequireAuth, children: [{ path: 'devices/:id', Component: FourQueries }] },
    ],
    '/devices/d1',
  );
  const { visited, unsubscribe } = recordNavigations(router);

  expect(await screen.findByText('login page')).toBeInTheDocument();
  await delay(50);
  unsubscribe();
  expect(refresh.count).toBe(2);
  expect(visited).toEqual(['/login?next=%2Fdevices%2Fd1']);
  expect(location(router)).toBe('/login?next=%2Fdevices%2Fd1');
});

test('signedIn seeds me without a request, and signOut logs out and clears the cache', async () => {
  refreshHandler([unauthorized]);
  const calls = { me: 0, logout: 0 };
  server.use(
    http.get(`${base}/api/v1/me`, () => {
      calls.me += 1;
      return HttpResponse.json(meFixture());
    }),
    http.post(`${base}/api/auth/logout`, () => {
      calls.logout += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { queryClient } = mount([{ path: '*', Component: Controls }], '/');
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('anonymous:'));

  await user.click(screen.getByRole('button', { name: 'sign in' }));
  expect(screen.getByTestId('probe')).toHaveTextContent('authenticated:Johnny');
  expect(queryClient.getQueryData(queryKeys.me)).toEqual(session.user);

  await user.click(screen.getByRole('button', { name: 'sign out' }));
  await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('anonymous:'));
  expect(calls.logout).toBe(1);
  expect(calls.me).toBe(0);
  expect(queryClient.getQueryData(queryKeys.me)).toBeUndefined();
});

test('RequireAnon sends signed-in users to a safe next or /devices', async () => {
  refreshHandler([() => HttpResponse.json(session)]);
  const routes: RouteObject[] = [
    { Component: RequireAnon, children: [{ path: 'login', element: <p>login page</p> }] },
    { path: 'devices', element: <p>devices page</p> },
    { path: 'devices/:id', element: <p>device page</p> },
  ];
  const first = mount(routes, '/login?next=%2Fdevices%2Fd1');
  expect(await screen.findByText('device page')).toBeInTheDocument();
  expect(location(first.router)).toBe('/devices/d1');
});

test('RequireAnon ignores an unsafe next', async () => {
  refreshHandler([() => HttpResponse.json(session)]);
  const { router } = mount(
    [
      { Component: RequireAnon, children: [{ path: 'login', element: <p>login page</p> }] },
      { path: 'devices', element: <p>devices page</p> },
    ],
    '/login?next=%2F%2Fevil.example',
  );
  expect(await screen.findByText('devices page')).toBeInTheDocument();
  expect(location(router)).toBe('/devices');
});

test('RequireAnon shows the page to anonymous users', async () => {
  refreshHandler([unauthorized]);
  mount(
    [{ Component: RequireAnon, children: [{ path: 'login', element: <p>login page</p> }] }],
    '/login',
  );
  expect(await screen.findByText('login page')).toBeInTheDocument();
});

test('renderRoute: an anonymous visit to /devices lands on /login with next', async () => {
  const { router } = renderRoute('/devices');
  await waitFor(() => expect(location(router)).toBe('/login?next=%2Fdevices'));
});

test('renderRoute: the me preset signs in and keeps /devices', async () => {
  const { router } = renderRoute('/devices', { me: meFixture() });
  await waitFor(() =>
    expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument(),
  );
  expect(location(router)).toBe('/devices');
});
