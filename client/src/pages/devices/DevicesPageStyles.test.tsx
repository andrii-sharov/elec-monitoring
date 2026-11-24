import { act, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { appStylePreference } from '@/appStyles/registry';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

vi.mock('@/appStyles/sonar', async () => {
  const { classic } = await import('@/appStyles/classic');
  return {
    sonar: {
      ...classic,
      id: 'sonar',
      slots: {
        ...classic.slots,
        DeviceSummary: () => <div data-app-style-slot="sonar">sonar summary</div>,
      },
    },
  };
});

test('switching the stored style re-renders the list with that style’s summary', async () => {
  server.use(
    http.get('http://localhost:3000/api/v1/devices', () =>
      HttpResponse.json({ items: [deviceFixture()] }),
    ),
  );
  appStylePreference.write('classic');
  renderRoute('/devices', { me: meFixture() });
  const classicSummary = await screen.findByRole('link', { name: /Home/ });
  expect(classicSummary).toHaveAttribute('data-app-style-slot', 'classic');
  act(() => appStylePreference.write('sonar'));
  expect(await screen.findByText('sonar summary')).toHaveAttribute('data-app-style-slot', 'sonar');
});
