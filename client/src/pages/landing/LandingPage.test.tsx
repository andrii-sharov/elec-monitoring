import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';

test('a signed-out visitor sees the landing page with sign-up and log-in links', async () => {
  renderRoute('/');
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Power outage alerts for your home' }),
  ).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Main' });
  expect(within(nav).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  const signups = screen.getAllByRole('link', { name: 'Create free account' });
  expect(signups.length).toBeGreaterThan(0);
  for (const link of signups) expect(link).toHaveAttribute('href', '/signup');
  expect(screen.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '#how');
  expect(screen.getByRole('heading', { name: 'Three steps to your first alert' })).toBeVisible();
});

test('a signed-in user goes straight to devices', async () => {
  const { router } = renderRoute('/', { me: meFixture() });
  await screen.findByRole('heading', { level: 1, name: 'Devices' });
  expect(router.state.location.pathname).toBe('/devices');
});

test('the old welcome page sends a signed-in user to devices', async () => {
  const { router } = renderRoute('/welcome/appearance?next=%2Faccount', { me: meFixture() });
  await screen.findByRole('heading', { level: 1, name: 'Devices' });
  expect(router.state.location.pathname).toBe('/devices');
});
