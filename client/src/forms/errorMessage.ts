import { formatDuration } from '@elec/shared';
import type { TFunction } from 'i18next';
import { isApiError } from '../api/errors.ts';

export function errorMessage(t: TFunction, error: unknown): string {
  if (!isApiError(error)) return t('app.errors.generic');
  if (error.code === 'rate_limited' && error.retryAfterS !== null) {
    const wait = formatDuration(error.retryAfterS, (key, options) => t(key, options));
    return t('app.auth.rateLimited', { wait });
  }
  return t(`app.errors.${error.code}`);
}
