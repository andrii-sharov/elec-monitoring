import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { meFixture } from '../../test/fixtures.ts';
import { renderRoute } from '../../test/render.tsx';
import { server } from '../../test/server.ts';

const base = 'http://localhost:3000';

function devicesHandler() {
  server.use(http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [] })));
}

async function openMenu() {
  devicesHandler();
  const view = renderRoute('/devices', { me: meFixture({ name: 'Johnny' }) });
  const button = await screen.findByRole('button', { name: 'Account menu' });
  button.focus();
  await view.user.keyboard('{Enter}');
  return view;
}

test('the account menu opens with the keyboard and shows its items', async () => {
  await openMenu();
  expect(await screen.findByRole('menuitem', { name: /Account/ })).toHaveAttribute(
    'href',
    '/account',
  );
  const docs = screen.getByRole('menuitem', { name: /API docs/ });
  expect(docs).toHaveAttribute('href', `${base}/api/docs`);
  expect(docs).toHaveAttribute('target', '_blank');
  expect(docs).toHaveAttribute('rel', 'noreferrer');
  expect(screen.getByRole('menuitem', { name: /Sign out/ })).toBeInTheDocument();
});

test('Sign out calls the logout endpoint and lands on the login page', async () => {
  let loggedOut = false;
  server.use(
    http.post(`${base}/api/auth/logout`, () => {
      loggedOut = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user, router } = await openMenu();
  await user.click(await screen.findByRole('menuitem', { name: /Sign out/ }));
  await screen.findByRole('heading', { name: 'Log in' });
  expect(loggedOut).toBe(true);
  expect(router.state.location.pathname).toBe('/login');
});

test('the header keeps the main navigation and has no language select', async () => {
  devicesHandler();
  renderRoute('/devices', { me: meFixture() });
  await screen.findByRole('button', { name: 'Account menu' });
  expect(screen.getByRole('link', { name: 'Devices' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
});
