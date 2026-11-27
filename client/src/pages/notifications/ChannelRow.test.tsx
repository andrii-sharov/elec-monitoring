import { resources } from '@elec/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import {
  channelFixture,
  deviceFixture,
  meFixture,
  webhookFixture,
} from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const chat = channelFixture();
const hook = webhookFixture();

beforeEach(() => {
  server.use(
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [deviceFixture()] })),
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [chat, hook] })),
    http.get(`${base}/api/v1/channels/${hook.id}/deliveries`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
  );
});

async function expanded(name: string) {
  const view = renderRoute('/notifications', { me: meFixture() });
  await view.user.click(await screen.findByRole('button', { name: `Details for ${name}` }));
  const card = screen.getByText(name, { selector: 'span' }).closest('li') as HTMLElement;
  return { ...view, card };
}

test('a webhook card has Overview and Delivery log tabs with the log inside the card', async () => {
  const { user, card } = await expanded('Automation');
  expect(within(card).getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  await user.click(within(card).getByRole('tab', { name: 'Delivery log' }));
  expect(await within(card).findByRole('region', { name: 'Delivery log' })).toBeInTheDocument();
});

test('a Telegram card has no tabs', async () => {
  const { card } = await expanded('Home chat');
  expect(within(card).queryByRole('tablist')).toBeNull();
  expect(within(card).getByRole('button', { name: 'Send test' })).toBeInTheDocument();
});

test('secondary actions live in the more menu', async () => {
  const { user, card } = await expanded('Automation');
  expect(within(card).queryByRole('button', { name: 'Rename' })).toBeNull();
  await user.click(within(card).getByRole('button', { name: 'More actions for Automation' }));
  const menu = await screen.findByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual(['Rename', 'New secret', 'Remove']);
  await user.click(within(menu).getByRole('menuitem', { name: 'Remove' }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
});

test('a Telegram menu has no signing key', async () => {
  const { user, card } = await expanded('Home chat');
  await user.click(within(card).getByRole('button', { name: 'More actions for Home chat' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).queryByRole('menuitem', { name: 'New secret' })).toBeNull();
});

test('the webhook overview names events in words', async () => {
  const { card } = await expanded('Automation');
  expect(within(card).getByText('Device went offline')).toBeInTheDocument();
  expect(within(card).getByText('Device back online')).toBeInTheDocument();
  expect(within(card).queryByText(/device\.offline/)).toBeNull();
});

test('the status tag uses its own wording, not the filter label', () => {
  const ru = resources.ru.translation.app.notifications;
  expect(ru.state.active).toBe('Активен');
  expect(ru.state.active).not.toBe(ru.status.active);
});
