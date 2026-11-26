import { formatMoment } from '@elec/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  deliveryFixture,
  deviceFixture,
  meFixture,
  webhookFixture,
} from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const hook = webhookFixture();
const id = (n: number) => `1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a0${n}`;
const failed = deliveryFixture({
  id: id(1),
  status: 'FAILED',
  attempts: 6,
  last_error: 'HTTP 502',
});
const sent = deliveryFixture({ id: id(2), event: 'device.online' });
const queued = deliveryFixture({
  id: id(3),
  status: 'QUEUED',
  attempts: 0,
  last_attempt_at: null,
});
const retrying = deliveryFixture({ id: id(4), status: 'RETRYING', attempts: 2 });
const older = deliveryFixture({ id: id(5), event: 'device.power_blip' });

beforeEach(() => {
  server.use(
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [deviceFixture()] })),
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [hook] })),
  );
});

async function openLog() {
  const view = renderRoute('/notifications', { me: meFixture() });
  await view.user.click(await screen.findByRole('button', { name: 'Details for Automation' }));
  await view.user.click(screen.getByRole('button', { name: 'Delivery log' }));
  return { ...view, log: await screen.findByRole('region', { name: 'Delivery log' }) };
}

function rows(log: HTMLElement) {
  return within(log).getAllByRole('listitem');
}

function deliveries(handler: (cursor: string | null) => object) {
  server.use(
    http.get(`${base}/api/v1/channels/${hook.id}/deliveries`, ({ request }) =>
      HttpResponse.json(handler(new URL(request.url).searchParams.get('cursor'))),
    ),
  );
}

test('rows show the event, device, status, attempts, error and local time', async () => {
  deliveries(() => ({ items: [failed, sent, queued, retrying], next_cursor: null }));
  const { log } = await openLog();
  await within(log).findByText('HTTP 502');
  const [first, second, third, fourth] = rows(log) as HTMLElement[];
  expect(within(first!).getByText('device.offline')).toBeInTheDocument();
  expect(within(first!).getByText('Home')).toBeInTheDocument();
  expect(within(first!).getByText('Failed')).toHaveAttribute('data-slot', 'tag');
  expect(within(first!).getByText('Attempts: 6')).toBeInTheDocument();
  const time = formatMoment(new Date('2026-11-21T16:42:05Z'), 'en', 'Europe/Kyiv');
  expect(within(first!).getByText(time)).toBeInTheDocument();
  expect(within(second!).getByText('Sent')).toBeInTheDocument();
  expect(within(third!).getByText('Queued')).toBeInTheDocument();
  expect(within(fourth!).getByText('Retrying')).toBeInTheDocument();
  expect(within(first!).getByRole('button', { name: 'Redeliver' })).toBeEnabled();
  expect(within(second!).getByRole('button', { name: 'Redeliver' })).toBeEnabled();
  expect(within(third!).queryByRole('button', { name: 'Redeliver' })).toBeNull();
  expect(within(fourth!).queryByRole('button', { name: 'Redeliver' })).toBeNull();
  expect(within(log).queryByRole('button', { name: 'Load more' })).toBeNull();
});

test('the log is a panel with staggered rows that are not inside another entrance', async () => {
  deliveries(() => ({ items: [failed, sent], next_cursor: null }));
  const { log } = await openLog();
  await within(log).findByText('HTTP 502');
  expect(log).toHaveAttribute('data-motion', 'panel');
  const [first, second] = rows(log) as HTMLElement[];
  expect(first).toHaveAttribute('data-motion', 'enter');
  expect(second).toHaveAttribute('data-motion', 'enter');
  expect(second!.style.getPropertyValue('--i')).toBe('1');
  expect(log.closest('[data-motion="enter"]')).toBeNull();
});

test('load more follows the next cursor', async () => {
  const cursors: (string | null)[] = [];
  deliveries((cursor) => {
    cursors.push(cursor);
    return cursor
      ? { items: [older], next_cursor: null }
      : { items: [sent], next_cursor: 'page-2' };
  });
  const { user, log } = await openLog();
  await user.click(await within(log).findByRole('button', { name: 'Load more' }));
  expect(await within(log).findByText('device.power_blip')).toBeInTheDocument();
  expect(rows(log)).toHaveLength(2);
  expect(cursors).toContain('page-2');
  expect(within(log).queryByRole('button', { name: 'Load more' })).toBeNull();
});

test('redeliver queues the delivery again and refreshes the log', async () => {
  let items = [failed];
  const redelivered = vi.fn<() => void>();
  deliveries(() => ({ items, next_cursor: null }));
  server.use(
    http.post(`${base}/api/v1/deliveries/${failed.id}/redeliver`, () => {
      redelivered();
      const again = { ...failed, status: 'QUEUED' as const, attempts: 0, last_error: null };
      items = [again];
      return HttpResponse.json(again, { status: 202 });
    }),
  );
  const { user, log } = await openLog();
  await user.click(await within(log).findByRole('button', { name: 'Redeliver' }));
  expect(await within(log).findByText('Queued')).toBeInTheDocument();
  expect(redelivered).toHaveBeenCalledOnce();
  expect(within(log).queryByRole('button', { name: 'Redeliver' })).toBeNull();
});

test('a refused redeliver explains why', async () => {
  deliveries(() => ({ items: [failed], next_cursor: null }));
  server.use(
    http.post(`${base}/api/v1/deliveries/${failed.id}/redeliver`, () =>
      HttpResponse.json({ error: { code: 'conflict', message: 'x' } }, { status: 409 }),
    ),
  );
  const { user, log } = await openLog();
  await user.click(await within(log).findByRole('button', { name: 'Redeliver' }));
  expect(await screen.findByText('This delivery is still in progress.')).toBeInTheDocument();
});

test('a redeliver refused because the webhook was turned off updates the row', async () => {
  let items = [hook];
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items })),
    http.post(`${base}/api/v1/deliveries/${failed.id}/redeliver`, () => {
      items = [webhookFixture({ enabled: false, disabled_reason: 'TOO_MANY_FAILURES' })];
      return HttpResponse.json({ error: { code: 'conflict', message: 'x' } }, { status: 409 });
    }),
  );
  deliveries(() => ({ items: [failed], next_cursor: null }));
  const { user, log } = await openLog();
  await user.click(await within(log).findByRole('button', { name: 'Redeliver' }));
  expect(await screen.findByText('Turn the channel on first.')).toBeInTheDocument();
  expect(screen.getByText('Failing', { selector: '[data-slot="tag"]' })).toBeInTheDocument();
  expect(within(log).getByRole('button', { name: 'Redeliver' })).toBeDisabled();
});

test('a turned off webhook cannot redeliver', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () =>
      HttpResponse.json({ items: [webhookFixture({ enabled: false, disabled_reason: 'USER' })] }),
    ),
  );
  deliveries(() => ({ items: [failed], next_cursor: null }));
  const { log } = await openLog();
  expect(await within(log).findByRole('button', { name: 'Redeliver' })).toBeDisabled();
  expect(within(log).getByText('Turn the channel on to redeliver.')).toBeInTheDocument();
});

test('an empty log says so and a deleted device is named as unknown', async () => {
  let items: (typeof sent)[] = [];
  deliveries(() => ({ items, next_cursor: null }));
  const { user, log } = await openLog();
  expect(await within(log).findByText('No deliveries yet.')).toBeInTheDocument();
  items = [deliveryFixture({ device_id: '5d1a7b2c-3e4f-4a5b-8c6d-7e8f9a0b1c09' })];
  await user.click(screen.getByRole('button', { name: 'Delivery log' }));
  await user.click(screen.getByRole('button', { name: 'Delivery log' }));
  expect(await screen.findByText('Unknown device')).toBeInTheDocument();
});

test('a failed load more keeps the rows and shows the error', async () => {
  server.use(
    http.get(`${base}/api/v1/channels/${hook.id}/deliveries`, ({ request }) =>
      new URL(request.url).searchParams.has('cursor')
        ? HttpResponse.json({ error: { code: 'internal', message: 'x' } }, { status: 500 })
        : HttpResponse.json({ items: [sent], next_cursor: 'page-2' }),
    ),
  );
  const { user, log } = await openLog();
  await user.click(await within(log).findByRole('button', { name: 'Load more' }));
  expect(await within(log).findByRole('alert')).toHaveTextContent('Something went wrong');
  expect(rows(log)).toHaveLength(1);
});
