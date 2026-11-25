import { describe, expect, test } from 'vitest';
import { identifierSchema, normalizePhone, telegramPhone } from './common.ts';

function issues(body: unknown) {
  const result = identifierSchema.safeParse(body);
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    reason: issue.code === 'custom' ? issue.params?.reason : undefined,
  }));
}

describe('normalizePhone', () => {
  test.each(['050 123 45 67', '+38 (050) 123-45-67', '+380501234567', '380501234567'])(
    'reads %s as the same Ukrainian number',
    (raw) => {
      expect(normalizePhone(raw)).toBe('+380501234567');
    },
  );

  test('keeps another country code', () => {
    expect(normalizePhone('+48 512 345 678')).toBe('+48512345678');
  });

  test.each(['12', 'abc', '+3805012345678901', 'call 050 123 45 67'])('rejects %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe('telegramPhone', () => {
  test.each(['380501234567', '+380501234567'])('reads %s', (raw) => {
    expect(telegramPhone(raw)).toBe('+380501234567');
  });

  test('reads a foreign number without a plus as international', () => {
    expect(telegramPhone('48512345678')).toBe('+48512345678');
  });
});

describe('identifierSchema', () => {
  test('accepts an email', () => {
    expect(identifierSchema.parse({ email: ' John@Example.com ' })).toEqual({
      email: 'john@example.com',
    });
  });

  test('accepts a phone and normalizes it', () => {
    expect(identifierSchema.parse({ phone: '050 123 45 67' })).toEqual({
      phone: '+380501234567',
    });
  });

  test.each([[{}], [{ email: 'john@example.com', phone: '+380501234567' }]])(
    'rejects %j',
    (body) => {
      expect(identifierSchema.safeParse(body).success).toBe(false);
    },
  );

  test('reports an invalid phone on the phone field', () => {
    expect(issues({ phone: '12' })).toEqual([
      { path: 'phone', code: 'custom', reason: 'invalid_phone' },
    ]);
  });

  test('reports an invalid email on the email field', () => {
    expect(issues({ email: 'nope' })).toEqual([
      { path: 'email', code: 'invalid_format', reason: undefined },
    ]);
  });
});
