import { Navigate, Outlet, type RouteObject } from 'react-router';
import { RequireAnon, RequireAuth, SessionProvider } from '@/api/session';
import { AccountPage } from '@/pages/account/AccountPage';
import { Layout } from './Layout';
import { RequireAppearance } from './RequireAppearance';
import { AddDevicePage } from '@/pages/devices/AddDevicePage';
import { DevicePage } from '@/pages/devices/DevicePage';
import { DevicesPage } from '@/pages/devices/DevicesPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { GoogleCallbackPage } from '@/pages/auth/GoogleCallbackPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { SignupPage } from '@/pages/auth/SignupPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';
import { FlashPage } from '@/pages/firmware/FlashPage';
import { InvitePage } from '@/pages/invite/InvitePage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { NotFound } from '@/pages/NotFound';
import { WelcomeAppearancePage } from '@/pages/welcome/WelcomeAppearancePage';

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
      { path: 'invite', Component: InvitePage },
      { path: 'reset-password', Component: ResetPasswordPage },
      { path: 'auth/google', Component: GoogleCallbackPage },
      {
        Component: RequireAuth,
        children: [
          { path: 'welcome/appearance', Component: WelcomeAppearancePage },
          {
            Component: RequireAppearance,
            children: [
              {
                Component: Layout,
                children: [
                  { path: '/', element: <Navigate to="/devices" replace /> },
                  { path: 'devices', Component: DevicesPage },
                  { path: 'devices/new', Component: AddDevicePage },
                  { path: 'devices/:id', Component: DevicePage },
                  { path: 'flash', Component: FlashPage },
                  { path: 'notifications', Component: NotificationsPage },
                  { path: 'account', Component: AccountPage },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', Component: NotFound },
    ],
  },
];
