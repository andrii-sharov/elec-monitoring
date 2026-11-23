import type { Me } from '@elec/shared/api';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../src/app/providers.tsx';
import { routes } from '../src/app/router.tsx';
import { apiUrl } from '../src/lib/config.ts';
import { createClientI18n } from '../src/lib/i18n.ts';
import { sessionFixture } from './fixtures.ts';
import { server } from './server.ts';

type RenderRouteOptions = { me?: Me | null };

export const testAccessToken = 'test-access-token';

function presetSession(me: Me | null) {
  server.use(
    http.post(`${apiUrl()}/api/auth/refresh`, () =>
      me
        ? HttpResponse.json(sessionFixture({ access_token: testAccessToken, user: me }))
        : HttpResponse.json(
            { error: { code: 'unauthorized', message: 'Unauthorized' } },
            { status: 401 },
          ),
    ),
  );
}

export function renderRoute(path: string, { me = null }: RenderRouteOptions = {}) {
  presetSession(me);
  const user: UserEvent = userEvent.setup();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <StrictMode>
      <AppProviders i18n={createClientI18n('en')} queryClient={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
  return { user, router, queryClient };
}
