import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { meFixture, sessionFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';

function loginHandler(spy = vi.fn<(body: unknown) => void>()) {
  server.use(
    http.post(`${base}/api/auth/login`, async ({ request }) => {
      spy(await request.json());
      return HttpResponse.json(sessionFixture());
    }),
  );
  return spy;
}

async function fillAndSubmit(user: ReturnType<typeof renderRoute>['user'], password = 'password1') {
  await user.type(await screen.findByLabelText('Email'), 'johnny@example.com');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

test('empty submit shows field errors and sends nothing', async () => {
  const spy = loginHandler();
  const { user } = renderRoute('/login');
  await user.click(await screen.findByRole('button', { name: 'Log in' }));
  expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  expect(screen.getByText('At least 1 characters')).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

test('wrong password shows the form error', async () => {
  server.use(
    http.post(`${base}/api/auth/login`, () =>
      HttpResponse.json({ error: { code: 'invalid_credentials', message: 'x' } }, { status: 401 }),
    ),
  );
  const { user } = renderRoute('/login');
  await fillAndSubmit(user);
  expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
});

test('rate limit shows the wait', async () => {
  server.use(
    http.post(`${base}/api/auth/login`, () =>
      HttpResponse.json(
        { error: { code: 'rate_limited', message: 'x' } },
        { status: 429, headers: { 'Retry-After': '120' } },
      ),
    ),
  );
  const { user } = renderRoute('/login');
  await fillAndSubmit(user);
  expect(await screen.findByText('Too many attempts. Try again in 2 min.')).toBeInTheDocument();
});

test('success goes to /devices', async () => {
  loginHandler();
  const { user, router } = renderRoute('/login');
  await fillAndSubmit(user);
  await waitFor(() => expect(router.state.location.pathname).toBe('/devices'));
});

test('success returns to the deep link', async () => {
  loginHandler();
  const { user, router } = renderRoute('/login?next=%2Fdevices%2Fd1');
  await fillAndSubmit(user);
  await waitFor(() => expect(router.state.location.pathname).toBe('/devices/d1'));
});

test('an open-redirect next goes to /devices', async () => {
  loginHandler();
  const { user, router } = renderRoute('/login?next=%2F%2Fevil.example');
  await fillAndSubmit(user);
  await waitFor(() => expect(router.state.location.pathname).toBe('/devices'));
});

test('a signed-in user is sent away from /login', async () => {
  const { router } = renderRoute('/login', { me: meFixture() });
  await waitFor(() => expect(router.state.location.pathname).toBe('/devices'));
});
