import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';

async function renderAccount() {
  const view = renderRoute('/account?tab=appearance', { me: meFixture() });
  await screen.findByRole('heading', { level: 1 });
  return view;
}

test('appearance has the theme choice and no style picker', async () => {
  await renderAccount();
  expect(screen.queryByRole('radiogroup', { name: 'App style' })).toBeNull();
  expect(
    screen.getByText('Light, dark or the system setting. Saved only in this browser.'),
  ).toBeInTheDocument();
});

test('choosing Dark applies the theme without a request', async () => {
  const { user } = await renderAccount();
  const theme = screen.getByRole('radiogroup', { name: 'Theme' });
  await user.click(within(theme).getByRole('radio', { name: 'Dark' }));
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('em.theme')).toBe('dark');
});

test('the profile form has no theme field and Save waits for a profile change', async () => {
  const { user } = renderRoute('/account', { me: meFixture() });
  await screen.findByRole('heading', { level: 1 });
  const profile = screen.getByRole('region', { name: 'Profile' });
  expect(within(profile).queryByRole('combobox', { name: 'Theme' })).toBeNull();
  const save = within(profile).getByRole('button', { name: 'Save' });
  expect(save).toBeDisabled();
  await user.type(within(profile).getByRole('textbox', { name: 'Name' }), 'ny');
  expect(save).toBeEnabled();
});

test('the theme picker splits evenly with short labels on phones', async () => {
  await renderAccount();
  const theme = screen.getByRole('radiogroup', { name: 'Theme' });
  expect(theme).toHaveClass('max-sm:grid', 'max-sm:grid-cols-3');
  const system = within(theme).getByRole('radio', { name: 'System' });
  expect(system).toHaveClass('max-sm:flex-col');
});

test('account tabs use short labels', async () => {
  await renderAccount();
  expect(screen.getByRole('tab', { name: 'Security' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Delete account' })).toBeInTheDocument();
});
