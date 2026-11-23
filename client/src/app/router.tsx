import { Outlet, type RouteObject } from 'react-router';
import { RequireAuth, SessionProvider } from '@/api/session';
import { NotFound } from '@/pages/NotFound';

export const routes: RouteObject[] = [
  {
    element: (
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    ),
    children: [
      { Component: RequireAuth, children: [{ path: 'devices' }] },
      { path: '*', Component: NotFound },
    ],
  },
];
