import { expect, test } from 'vitest';
import { safeNext } from './safeNext.ts';

test('keeps a same-origin path', () => {
  expect(safeNext('/devices/abc')).toBe('/devices/abc');
  expect(safeNext('/account?confirmDelete=1')).toBe('/account?confirmDelete=1');
});

test.each([
  ['//evil.example'],
  ['/\\evil'],
  ['https://evil.example'],
  ['devices'],
  ['/\t/evil.example'],
  [''],
  [null],
])('falls back to /devices for %j', (raw) => {
  expect(safeNext(raw)).toBe('/devices');
});
