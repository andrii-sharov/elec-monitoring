import { Navigate, Outlet, type RouteObject } from 'react-router';
import { RequireAnon, RequireAuth, SessionProvider } from '@/api/session';
import { Layout } from './Layout';
import { AddDevicePage } from '@/pages/devices/AddDevicePage';
import { DevicePage } from '@/pages/devices/DevicePage';
import { DevicesPage } from '@/pages/devices/DevicesPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { GoogleCallbackPage } from '@/pages/auth/GoogleCallbackPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { SignupPage } from '@/pages/auth/SignupPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { NotFound } from '@/pages/NotFound';

export const routes: RouteObject[] = [
  {
    element: (
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    ),
    children: [
      {
        Component: RequireAnon,
        children: [
          { path: 'login', Component: LoginPage },
          { path: 'signup', Component: SignupPage },
          { path: 'forgot-password', Component: ForgotPasswordPage },
        ],
      },
      { path: 'verify-email', Component: VerifyEmailPage },
      { path: 'reset-password', Component: ResetPasswordPage },
      { path: 'auth/google', Component: GoogleCallbackPage },
      {
        Component: RequireAuth,
        children: [
          {
            Component: Layout,
            children: [
              { path: '/', element: <Navigate to="/devices" replace /> },
              { path: 'devices', Component: DevicesPage },
              { path: 'devices/new', Component: AddDevicePage },
              { path: 'devices/:id', Component: DevicePage },
              { path: 'notifications', Component: NotificationsPage },
            ],
          },
        ],
      },
      { path: '*', Component: NotFound },
    ],
  },
];
