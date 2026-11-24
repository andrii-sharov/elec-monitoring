import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors.ts';

const maxRetries = 3;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < maxRetries;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });
}
