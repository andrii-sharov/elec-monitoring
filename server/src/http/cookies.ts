import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_TTL_S } from '../auth/sessions.ts';

export const REFRESH_COOKIE = 'em_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';

const baseOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: REFRESH_COOKIE_PATH,
};

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, maxAge: REFRESH_TTL_S * 1000 });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions);
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const OAUTH_COOKIE = 'em_oauth';
const OAUTH_COOKIE_PATH = '/api/auth/google';
const OAUTH_TTL_S = 600;

const oauthOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: OAUTH_COOKIE_PATH,
};

export function setOAuthCookie(res: Response, value: string): void {
  res.cookie(OAUTH_COOKIE, value, { ...oauthOptions, maxAge: OAUTH_TTL_S * 1000 });
}

export function clearOAuthCookie(res: Response): void {
  res.clearCookie(OAUTH_COOKIE, oauthOptions);
}

export function readOAuthCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[OAUTH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
