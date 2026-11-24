import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const device = deviceFixture({ id: 'abc' });

beforeEach(() => {
  localStorage.removeItem('em.appStyle');
  server.use(
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [device] })),
    http.get(`${base}/api/v1/devices/abc`, () => HttpResponse.json(device)),
    http.get(`${base}/api/v1/devices/abc/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get(`${base}/api/v1/devices/abc/channels`, () => HttpResponse.json({ channel_ids: [] })),
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
  );
});

async function findWelcome() {
  return screen.findByRole('heading', { level: 1, name: 'Hello, Johnny' });
}

test('a first visit opens the picker, and Use this style saves it and returns', async () => {
  const { user, router } = renderRoute('/devices/abc', { me: meFixture() });
  await findWelcome();
  expect(router.state.location.pathname).toBe('/welcome/appearance');
  const styles = screen.getByRole('radiogroup', { name: 'App style' });
  await user.click(within(styles).getByRole('radio', { name: 'Lamp' }));
  expect(localStorage.getItem('em.appStyle')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Use this style' }));
  expect(
    await screen.findByRole('heading', { level: 1, name: /The power is on at Home/ }),
  ).toBeInTheDocument();
  expect(localStorage.getItem('em.appStyle')).toBe('lamp');
  expect(router.state.location.pathname).toBe('/devices/abc');
});

test('Keep Classic saves classic and goes on', async () => {
  const { user, router } = renderRoute('/devices', { me: meFixture() });
  await findWelcome();
  await user.click(screen.getByRole('button', { name: 'Keep Classic' }));
  await screen.findByRole('heading', { level: 1, name: 'Devices' });
  expect(localStorage.getItem('em.appStyle')).toBe('classic');
  expect(router.state.location.pathname).toBe('/devices');
});

test('with a stored style the page renders directly', async () => {
  localStorage.setItem('em.appStyle', 'sonar');
  const { router } = renderRoute('/devices', { me: meFixture() });
  await screen.findByRole('heading', { level: 1, name: 'Devices' });
  expect(router.state.location.pathname).toBe('/devices');
});

test('an unsafe next goes to the devices list', async () => {
  const { user, router } = renderRoute('/welcome/appearance?next=//evil.example', {
    me: meFixture(),
  });
  await findWelcome();
  await user.click(screen.getByRole('button', { name: 'Keep Classic' }));
  await screen.findByRole('heading', { level: 1, name: 'Devices' });
  expect(router.state.location.pathname).toBe('/devices');
});

test('the picker stays reachable with a stored style', async () => {
  localStorage.setItem('em.appStyle', 'switchboard');
  const { router } = renderRoute('/welcome/appearance', { me: meFixture() });
  await findWelcome();
  expect(router.state.location.pathname).toBe('/welcome/appearance');
  expect(
    within(screen.getByRole('radiogroup', { name: 'App style' })).getByRole('radio', {
      name: 'Switchboard',
    }),
  ).toBeChecked();
});
