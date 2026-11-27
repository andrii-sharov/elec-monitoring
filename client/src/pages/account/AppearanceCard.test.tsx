import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';

async function renderAccount() {
  const view = renderRoute('/account?tab=appearance', { me: meFixture() });
  await screen.findByRole('heading', { level: 1 });
  return view;
}

test('choosing Sonar applies it to the page and remembers it in this browser', async () => {
  const { user } = await renderAccount();
  const styles = screen.getByRole('radiogroup', { name: 'App style' });
  await user.click(within(styles).getByRole('radio', { name: 'Sonar' }));
  expect(within(styles).getByRole('radio', { name: 'Sonar' })).toBeChecked();
  expect(document.documentElement.dataset.appStyle).toBe('sonar');
  expect(localStorage.getItem('em.appStyle')).toBe('sonar');
  expect(
    screen.getByText('How the app looks and moves: theme and style. Saved only in this browser.'),
  ).toBeInTheDocument();
});

test('arrow keys move the style selection', async () => {
  const { user } = await renderAccount();
  const styles = screen.getByRole('radiogroup', { name: 'App style' });
  within(styles).getByRole('radio', { name: 'Classic' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(within(styles).getByRole('radio', { name: 'Sonar' })).toHaveFocus();
  expect(localStorage.getItem('em.appStyle')).toBe('sonar');
});

test('each style option shows a live preview of its own style', async () => {
  await renderAccount();
  for (const id of ['classic', 'sonar', 'switchboard', 'lamp']) {
    expect(
      document.querySelector(`[data-app-style="${id}"] [data-app-style-slot="${id}"]`),
    ).not.toBeNull();
  }
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
