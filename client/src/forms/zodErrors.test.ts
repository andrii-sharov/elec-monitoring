import { emailSchema, passwordSchema, settingsPatchSchema } from '@elec/shared/api';
import { expect, test, vi } from 'vitest';
import { ApiError } from '../api/errors.ts';
import { createClientI18n } from '../lib/i18n.ts';
import { applyServerErrors, translateIssue } from './zodErrors.ts';

const i18n = createClientI18n('en');
const t = i18n.t.bind(i18n);

function firstIssue(result: { success: boolean; error?: { issues: unknown[] } }) {
  return result.error?.issues[0] as Parameters<typeof translateIssue>[0];
}

test('too_small string uses the string key with min', () => {
  expect(translateIssue(firstIssue(passwordSchema.safeParse('short')), t)).toBe(
    'At least 8 characters',
  );
});

test('too_big string uses the string key with max', () => {
  expect(translateIssue(firstIssue(passwordSchema.safeParse('x'.repeat(129))), t)).toBe(
    'At most 128 characters',
  );
});

test('invalid email', () => {
  expect(translateIssue(firstIssue(emailSchema.safeParse('nope')), t)).toBe(
    'Enter a valid email address',
  );
});

test('custom reason same_time', () => {
  const result = settingsPatchSchema.safeParse({ quiet_hours: { start: '22:00', end: '22:00' } });
  expect(translateIssue(firstIssue(result), t)).toBe('Start and end must differ');
});

test('unknown issues fall back to invalid', () => {
  expect(translateIssue(firstIssue(settingsPatchSchema.safeParse({ nope: 1 })), t)).toBe(
    'Invalid value',
  );
});

test('applyServerErrors maps details onto known fields', () => {
  const setError = vi.fn<(name: string, error: { type: string; message: string }) => void>();
  const error = new ApiError({
    status: 400,
    code: 'validation_error',
    details: [
      { path: 'settings.ping_interval_s', code: 'too_small', min: 15 },
      { path: 'name', code: 'too_big', max: 100 },
    ],
  });
  const handled = applyServerErrors(error, setError, ['ping_interval_s', 'name'], t);
  expect(handled).toBe(true);
  expect(setError).toHaveBeenCalledWith('ping_interval_s', {
    type: 'server',
    message: 'At least 15',
  });
  expect(setError).toHaveBeenCalledWith('name', { type: 'server', message: 'At most 100' });
});

test('applyServerErrors returns false when a detail has no field', () => {
  const setError = vi.fn<(name: string, error: { type: string; message: string }) => void>();
  const error = new ApiError({
    status: 400,
    code: 'validation_error',
    details: [
      { path: 'email', code: 'invalid_format' },
      { path: 'mystery', code: 'custom' },
    ],
  });
  expect(applyServerErrors(error, setError, ['email'], t)).toBe(false);
  expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Invalid value' });
});
