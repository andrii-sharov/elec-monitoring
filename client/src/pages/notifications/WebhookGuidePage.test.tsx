import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { deviceFixture, meFixture, webhookFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const guidePath = '/notifications/webhooks/guide';

beforeEach(() => {
  server.use(
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [deviceFixture()] })),
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [webhookFixture()] })),
  );
});

test('the guide walks through setup in order', async () => {
  renderRoute(guidePath, { me: meFixture() });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'How to connect a webhook' }),
  ).toBeInTheDocument();
  const steps = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('heading');
  expect(steps.map((step) => step.textContent)).toEqual([
    'Prepare a receiver',
    'Add the webhook',
    'Save the signing secret',
    'Check every request',
    'Answer quickly',
    'Send a test',
  ]);
});

test('the signature samples use the whole secret and the raw body', async () => {
  const { user } = renderRoute(guidePath, { me: meFixture() });
  await screen.findByRole('heading', { level: 1, name: 'How to connect a webhook' });
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName === 'P' && /whole value, including whsec_/.test(element.textContent),
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/createHmac\('sha256', secret\)/)).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Python' }));
  expect(screen.getByText(/hmac\.compare_digest/)).toBeInTheDocument();
});

test('the reference lists every header the receiver gets', async () => {
  renderRoute(guidePath, { me: meFixture() });
  const reference = await screen.findByRole('region', { name: 'Request reference' });
  for (const header of ['X-Elec-Event', 'X-Elec-Delivery', 'X-Elec-Signature', 'User-Agent']) {
    expect(within(reference).getByText(header)).toBeInTheDocument();
  }
  expect(within(reference).getByText(/"event": "device.offline"/)).toBeInTheDocument();
});

test('the Notifications page links to the guide even without webhooks', async () => {
  server.use(http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })));
  renderRoute('/notifications', { me: meFixture() });
  expect(await screen.findByRole('link', { name: 'How to connect a webhook' })).toHaveAttribute(
    'href',
    guidePath,
  );
});
