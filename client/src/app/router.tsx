import { Outlet, type RouteObject } from 'react-router';
import { RequireAnon, RequireAuth, SessionProvider } from '@/api/session';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { GoogleCallbackPage } from '@/pages/auth/GoogleCallbackPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { SignupPage } from '@/pages/auth/SignupPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';
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
      { Component: RequireAuth, children: [{ path: 'devices' }] },
      { path: '*', Component: NotFound },
    ],
  },
];
