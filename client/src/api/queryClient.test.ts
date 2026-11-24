import { describe, expect, test } from 'vitest';
import { ApiError } from './errors.ts';
import { shouldRetry } from './queryClient.ts';

function apiError(status: number) {
  return new ApiError({ status, code: 'internal' });
}

describe('shouldRetry', () => {
  test.each([401, 404, 429])('does not retry %i', (status) => {
    expect(shouldRetry(0, apiError(status))).toBe(false);
  });

  test('retries network errors and 500', () => {
    expect(shouldRetry(0, new TypeError('fetch failed'))).toBe(true);
    expect(shouldRetry(0, apiError(500))).toBe(true);
  });

  test('stops after 3 retries', () => {
    expect(shouldRetry(3, apiError(500))).toBe(false);
    expect(shouldRetry(3, new TypeError('fetch failed'))).toBe(false);
  });
});
