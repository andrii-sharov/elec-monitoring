import { expect, test } from 'vitest';
import { decodeCursor, encodeCursor, limitSchema } from './pagination.ts';

test('a cursor round-trips', () => {
  const cursor = encodeCursor(['2026-11-21T16:42:00.000Z', 'abc']);
  expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(decodeCursor(cursor, 2)).toEqual(['2026-11-21T16:42:00.000Z', 'abc']);
});

test.each([
  ['bad base64', '%%%'],
  ['not JSON', Buffer.from('nope').toString('base64url')],
  ['wrong arity', encodeCursor(['a'])],
  ['non-strings', Buffer.from(JSON.stringify([1, 2])).toString('base64url')],
  ['an object', Buffer.from(JSON.stringify({ a: 1 })).toString('base64url')],
])('rejects %s', (_name, cursor) => {
  expect(() => decodeCursor(cursor, 2)).toThrow(
    expect.objectContaining({ status: 400, code: 'validation_error' }),
  );
});

test('limit defaults to 50 and stays within 1..100', () => {
  expect(limitSchema.parse(undefined)).toBe(50);
  expect(limitSchema.parse('100')).toBe(100);
  expect(limitSchema.safeParse('0').success).toBe(false);
  expect(limitSchema.safeParse('101').success).toBe(false);
});
