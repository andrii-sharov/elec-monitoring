import { googleIntents, type GoogleIntent } from '@elec/shared';
import { apiUrl } from './config.ts';
import { safeNext } from './safeNext.ts';

const storageKey = 'em.google';

const defaultNext: Record<GoogleIntent, string> = { LOGIN: '/devices', LINK: '/account' };

type GoogleState = { intent: GoogleIntent; next: string };

export function startGoogle(intent: GoogleIntent, next: string = defaultNext[intent]): void {
  sessionStorage.setItem(storageKey, JSON.stringify({ intent, next }));
  window.location.assign(`${apiUrl()}/api/auth/google?app=CLIENT&intent=${intent}`);
}

export function takeGoogleState(): GoogleState | null {
  const raw = sessionStorage.getItem(storageKey);
  sessionStorage.removeItem(storageKey);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { intent, next } = parsed as { intent?: unknown; next?: unknown };
  const known = googleIntents.find((value) => value === intent);
  if (!known) return null;
  return { intent: known, next: typeof next === 'string' ? safeNext(next) : defaultNext[known] };
}
