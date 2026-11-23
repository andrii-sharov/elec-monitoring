import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const problem = (code: string, status: number) =>
  HttpResponse.json({ error: { code, message: code } }, { status });

const originalLocation = window.location;
const assign = vi.fn<(url: string) => void>();

beforeEach(() => {
  assign.mockReset();
  sessionStorage.clear();
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  vi.stubGlobal('location', originalLocation);
});

async function renderAccount(me = meFixture(), path = '/account') {
  const view = renderRoute(path, { me });
  await screen.findByRole('heading', { level: 1 });
  return view;
}

function captureBody<T>(url: string, method: 'patch' | 'post' | 'delete', status = 200, json?: T) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${base}${url}`, async ({ request }) => {
      const text = await request.text();
      bodies.push(text ? JSON.parse(text) : null);
      return json === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(json);
    }),
  );
  return bodies;
}

test('changing language to uk sends the patch and switches the page', async () => {
  const bodies = captureBody('/api/v1/me', 'patch', 200, meFixture({ language: 'uk' }));
  const { user } = await renderAccount();
  await user.click(screen.getByRole('combobox', { name: 'Interface language' }));
  await user.click(await screen.findByRole('option', { name: 'Українська' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('heading', { level: 1, name: 'Обліковий запис' });
  expect(bodies).toEqual([{ language: 'uk' }]);
});

test('the header language switcher also patches the profile when signed in', async () => {
  const bodies = captureBody('/api/v1/me', 'patch', 200, meFixture({ language: 'ru' }));
  const { user } = await renderAccount();
  await user.click(screen.getByRole('combobox', { name: 'Language' }));
  await user.click(await screen.findByRole('option', { name: 'Русский' }));
  await screen.findByRole('heading', { level: 1, name: 'Аккаунт' });
  expect(bodies).toEqual([{ language: 'ru' }]);
});

test('an empty name shows an inline error and sends nothing', async () => {
  const bodies = captureBody('/api/v1/me', 'patch', 200, meFixture());
  const { user } = await renderAccount();
  await user.clear(screen.getByRole('textbox', { name: 'Name' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Required')).toBeInTheDocument();
  expect(bodies).toEqual([]);
});

test('timezone search finds Europe/Kyiv and saves it', async () => {
  const bodies = captureBody('/api/v1/me', 'patch', 200, meFixture({ timezone: 'Europe/Kyiv' }));
  const { user } = await renderAccount(meFixture({ timezone: 'UTC' }));
  await user.click(screen.getByRole('button', { name: /Time zone/ }));
  await user.type(screen.getByRole('searchbox', { name: 'Search time zones' }), 'kyiv');
  await user.click(await screen.findByRole('button', { name: 'Europe/Kyiv' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies).toEqual([{ timezone: 'Europe/Kyiv' }]));
});

test('theme choice applies locally without a request', async () => {
  const { user } = await renderAccount();
  await user.click(screen.getByRole('combobox', { name: 'Theme' }));
  await user.click(await screen.findByRole('option', { name: 'Dark' }));
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('em.theme')).toBe('dark');
});

test('unlink Google with 409 explains to add a password first', async () => {
  server.use(http.delete(`${base}/api/auth/google`, () => problem('conflict', 409)));
  const { user } = await renderAccount(meFixture({ google_linked: true }));
  await user.click(screen.getByRole('button', { name: 'Unlink Google' }));
  expect(await screen.findByText('Add a password first: use Forgot password.')).toBeInTheDocument();
});

test('unlink Google success switches to Link Google', async () => {
  server.use(http.delete(`${base}/api/auth/google`, () => new HttpResponse(null, { status: 204 })));
  const { user } = await renderAccount(meFixture({ google_linked: true }));
  await user.click(screen.getByRole('button', { name: 'Unlink Google' }));
  expect(await screen.findByRole('button', { name: 'Link Google' })).toBeInTheDocument();
});

test('Link Google stores the intent and navigates to the API', async () => {
  const { user } = await renderAccount();
  await user.click(screen.getByRole('button', { name: 'Link Google' }));
  expect(JSON.parse(sessionStorage.getItem('em.google') ?? 'null')).toEqual({
    intent: 'LINK',
    next: '/account',
  });
  expect(assign).toHaveBeenCalledWith(`${base}/api/auth/google?app=CLIENT&intent=LINK`);
});

test('change password: mismatch shows an inline error and sends nothing', async () => {
  const bodies = captureBody('/api/auth/change-password', 'post');
  const { user } = await renderAccount();
  await user.type(screen.getByLabelText('Current password'), 'old-password');
  await user.type(screen.getByLabelText('New password'), 'new-password-1');
  await user.type(screen.getByLabelText('Repeat the new password'), 'new-password-2');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  expect(bodies).toEqual([]);
});

test('change password: 403 puts the error on the current password field', async () => {
  server.use(
    http.post(`${base}/api/auth/change-password`, () => problem('invalid_credentials', 403)),
  );
  const { user } = await renderAccount();
  await user.type(screen.getByLabelText('Current password'), 'wrong-password');
  await user.type(screen.getByLabelText('New password'), 'new-password-1');
  await user.type(screen.getByLabelText('Repeat the new password'), 'new-password-1');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('Wrong password')).toBeInTheDocument();
  expect(screen.getByLabelText('Current password')).toBeInvalid();
});

test('change password: success toasts that other sessions were signed out', async () => {
  const bodies = captureBody('/api/auth/change-password', 'post');
  const { user } = await renderAccount();
  await user.type(screen.getByLabelText('Current password'), 'old-password');
  await user.type(screen.getByLabelText('New password'), 'new-password-1');
  await user.type(screen.getByLabelText('Repeat the new password'), 'new-password-1');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(
    await screen.findByText('Password changed. Other sessions were signed out.'),
  ).toBeVisible();
  expect(bodies).toEqual([{ current_password: 'old-password', new_password: 'new-password-1' }]);
});

test('the password form is hidden for a Google-only account', async () => {
  await renderAccount(meFixture({ has_password: false, google_linked: true }));
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
});

test('Log out signs out and lands on plain /login', async () => {
  const calls = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/auth/logout`, () => {
      calls();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user, router } = await renderAccount();
  await user.click(screen.getByRole('button', { name: 'Log out' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toBe('');
  expect(calls).toHaveBeenCalledOnce();
});

test('Log out everywhere sends logout-all then lands on plain /login', async () => {
  const calls = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/auth/logout-all`, () => {
      calls();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user, router } = await renderAccount();
  await user.click(screen.getByRole('button', { name: 'Log out everywhere' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toBe('');
  expect(calls).toHaveBeenCalledOnce();
});

test('delete with a wrong password shows an error and stays signed in', async () => {
  server.use(http.delete(`${base}/api/v1/me`, () => problem('invalid_credentials', 403)));
  const { user, router } = await renderAccount();
  await user.click(screen.getByRole('button', { name: 'Delete account' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('Enter your password to confirm'), 'wrong');
  await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
  expect(await within(dialog).findByText('Wrong password')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/account');
});

test('delete with the password sends it and goes to /login with a toast', async () => {
  const bodies = captureBody('/api/v1/me', 'delete');
  const { user, router } = await renderAccount();
  await user.click(screen.getByRole('button', { name: 'Delete account' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('Enter your password to confirm'), 'secret-pass');
  await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toBe('');
  expect(bodies).toEqual([{ password: 'secret-pass' }]);
  expect(await screen.findByText('Account deleted')).toBeVisible();
});

test('Google-only delete asks to sign in again on reauth_required', async () => {
  server.use(http.delete(`${base}/api/v1/me`, () => problem('reauth_required', 403)));
  const { user } = await renderAccount(meFixture({ has_password: false, google_linked: true }));
  await user.click(screen.getByRole('button', { name: 'Delete account' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
  await user.click(
    await within(dialog).findByRole('button', { name: 'Sign in with Google again' }),
  );
  expect(JSON.parse(sessionStorage.getItem('em.google') ?? 'null')).toEqual({
    intent: 'LOGIN',
    next: '/account?confirmDelete=1',
  });
  expect(assign).toHaveBeenCalledWith(`${base}/api/auth/google?app=CLIENT&intent=LOGIN`);
});

test('?confirmDelete=1 opens the delete dialog', async () => {
  renderRoute('/account?confirmDelete=1', { me: meFixture() });
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
