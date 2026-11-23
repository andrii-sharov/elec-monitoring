import { expect, test } from 'vitest';
import {
  hashDeviceToken,
  hashPairingCode,
  isDeviceTokenFormat,
  newDeviceToken,
  newPairingCode,
  normalizePairingCode,
} from './credentials.ts';
import { sha256 } from '../lib/crypto.ts';

test('pairing codes use the unambiguous alphabet and rarely repeat', () => {
  const codes = Array.from({ length: 1000 }, newPairingCode);
  for (const code of codes) expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  expect(new Set(codes).size).toBeGreaterThanOrEqual(990);
});

test('normalization trims, uppercases and drops spaces and hyphens', () => {
  expect(normalizePairingCode(' k7q2-m9 xd ')).toBe('K7Q2M9XD');
});

test('hand-typed codes hash the same as the canonical code', () => {
  expect(hashPairingCode('k7q2 m9xd')).toEqual(hashPairingCode('K7Q2M9XD'));
  expect(hashPairingCode('K7Q2M9XD')).toEqual(sha256('K7Q2M9XD'));
});

test('device tokens are 64 lowercase hex chars and differ', () => {
  const a = newDeviceToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(newDeviceToken()).not.toBe(a);
  expect(hashDeviceToken(a)).toEqual(sha256(a));
});

test('token format check rejects other shapes', () => {
  expect(isDeviceTokenFormat(newDeviceToken())).toBe(true);
  expect(isDeviceTokenFormat('A'.repeat(64))).toBe(false);
  expect(isDeviceTokenFormat('a'.repeat(63))).toBe(false);
  expect(isDeviceTokenFormat(`em_live_${'a'.repeat(56)}`)).toBe(false);
});
