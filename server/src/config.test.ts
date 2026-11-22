import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

function catchError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected ConfigError');
}

test('loads valid env', () => {
  expect(loadConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db', PORT: '8080' })).toEqual({
    databaseUrl: 'postgres://u:p@h:5432/db',
    port: 8080,
  });
});

test('PORT defaults to 3000', () => {
  expect(loadConfig({ DATABASE_URL: 'postgres://h/db' }).port).toBe(3000);
});

test('lists every invalid key without printing values', () => {
  const err = catchError(() => loadConfig({ PORT: 'abc', DATABASE_URL: 'not a url' }));
  expect(err.keys).toEqual(['DATABASE_URL', 'PORT']);
  expect(err.message).toBe('Invalid environment: DATABASE_URL, PORT');
  expect(err.message).not.toContain('not a url');
});

test('missing DATABASE_URL fails', () => {
  expect(catchError(() => loadConfig({})).keys).toEqual(['DATABASE_URL']);
});

test('rejects a non-Postgres URL', () => {
  expect(catchError(() => loadConfig({ DATABASE_URL: 'https://example.com' })).keys).toEqual([
    'DATABASE_URL',
  ]);
});
