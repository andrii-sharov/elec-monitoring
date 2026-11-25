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
  await user.type(await screen.findByLabelText('Email or phone'), 'johnny@example.com');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

test('empty submit shows field errors and sends nothing', async () => {
  const spy = loginHandler();
  const { user } = renderRoute('/login');
  await user.click(await screen.findByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(screen.getAllByText('Required')).toHaveLength(2));
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
  expect(await screen.findByText('Wrong email, phone or password.')).toBeInTheDocument();
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

test('an email in the link prefills the form', async () => {
  renderRoute('/login?email=mary%40example.com');
  expect(await screen.findByLabelText('Email or phone')).toHaveValue('mary@example.com');
});

test.each([
  ['+380501234567', { phone: '+380501234567' }],
  ['050 123 45 67', { phone: '+380501234567' }],
  ['john@example.com', { email: 'john@example.com' }],
])('logs in with %s', async (identifier, expected) => {
  const spy = loginHandler();
  const { user } = renderRoute('/login');
  await user.type(await screen.findByLabelText('Email or phone'), identifier);
  await user.type(screen.getByLabelText('Password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ ...expected, password: 'password1' }));
});

test('prefills the phone from the link', async () => {
  renderRoute('/login?phone=%2B380501234567');
  expect(await screen.findByLabelText('Email or phone')).toHaveValue('+380 50 123 4567');
});

test('a short phone is caught before sending', async () => {
  const spy = loginHandler();
  const { user } = renderRoute('/login');
  await user.type(await screen.findByLabelText('Email or phone'), '12');
  await user.type(screen.getByLabelText('Password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByText('Enter a valid phone number')).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

test('a number formats as it is typed and shows the country', async () => {
  const { user } = renderRoute('/login');
  const field = await screen.findByLabelText('Email or phone');
  expect(screen.queryByRole('button', { name: /Country code/ })).not.toBeInTheDocument();
  expect(field).toHaveAttribute('placeholder', 'name@example.com or 050 123 4567');
  await user.type(field, '0501234567');
  expect(field).toHaveValue('050 123 4567');
  expect(screen.getByRole('button', { name: 'Country code: Ukraine +380' })).toBeVisible();
});

test('letters switch the field back to email', async () => {
  const { user } = renderRoute('/login');
  const field = await screen.findByLabelText('Email or phone');
  await user.type(field, '050j');
  expect(field).toHaveValue('050j');
  expect(screen.queryByRole('button', { name: /Country code/ })).not.toBeInTheDocument();
});

test('picking a country reads the number in that country', async () => {
  const spy = loginHandler();
  const { user } = renderRoute('/login');
  const field = await screen.findByLabelText('Email or phone');
  await user.type(field, '512345678');
  await user.click(screen.getByRole('button', { name: /Country code/ }));
  await user.type(screen.getByRole('searchbox', { name: 'Search country or code' }), '+48');
  await user.click(await screen.findByRole('button', { name: /Poland/ }));
  expect(field).toHaveValue('512 345 678');
  await user.type(screen.getByLabelText('Password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() =>
    expect(spy).toHaveBeenCalledWith({ phone: '+48512345678', password: 'password1' }),
  );
});

test('an incomplete email is caught before sending', async () => {
  const spy = loginHandler();
  const { user } = renderRoute('/login');
  await user.type(await screen.findByLabelText('Email or phone'), 'john@');
  await user.type(screen.getByLabelText('Password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});
