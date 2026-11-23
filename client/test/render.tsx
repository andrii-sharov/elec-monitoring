import type { Me } from '@elec/shared/api';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../src/app/providers.tsx';
import { routes } from '../src/app/router.tsx';
import { createClientI18n } from '../src/lib/i18n.ts';

type RenderRouteOptions = { me?: Me | null };

export function renderRoute(path: string, _options: RenderRouteOptions = {}) {
  const user: UserEvent = userEvent.setup();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProviders i18n={createClientI18n('en')} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { user, router };
}
