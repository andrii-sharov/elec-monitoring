import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { APP_OFFSET, signedRelease, testKeyPair } from '../../test/firmware.ts';
import { verifyRelease } from './verify.ts';

const keys = testKeyPair();
const other = testKeyPair();

test('accepts a release signed with the key and returns the app hash', () => {
  const files = signedRelease(keys.privateKeyPem);
  const { sha256 } = verifyRelease(files, keys.publicKeyPem);
  expect(sha256).toEqual(createHash('sha256').update(files.app).digest());
});

test('rejects a signature made with another key', () => {
  const files = signedRelease(other.privateKeyPem);
  expect(() => verifyRelease(files, keys.publicKeyPem)).toThrow(/signature/i);
});

test('rejects an app changed after signing', () => {
  const files = signedRelease(keys.privateKeyPem);
  const app = Uint8Array.from(files.app);
  app[100]! ^= 0xff;
  expect(() => verifyRelease({ ...files, app }, keys.publicKeyPem)).toThrow(/signature/i);
});

test('rejects a factory image without the app at 0x10000', () => {
  const files = signedRelease(keys.privateKeyPem);
  const factory = Uint8Array.from(files.factory);
  factory[APP_OFFSET + 10]! ^= 0xff;
  expect(() => verifyRelease({ ...files, factory }, keys.publicKeyPem)).toThrow(
    /factory\.bin does not hold app\.bin/,
  );
});

test('rejects a short factory image', () => {
  const files = signedRelease(keys.privateKeyPem);
  const factory = files.factory.subarray(0, APP_OFFSET + 100);
  expect(() => verifyRelease({ ...files, factory }, keys.publicKeyPem)).toThrow(
    /factory\.bin is shorter/,
  );
});

test('rejects an empty app', () => {
  const files = signedRelease(keys.privateKeyPem, new Uint8Array());
  expect(() => verifyRelease(files, keys.publicKeyPem)).toThrow(/app\.bin is empty/);
});

test('rejects a garbage signature', () => {
  const files = { ...signedRelease(keys.privateKeyPem), signature: new Uint8Array([1, 2, 3]) };
  expect(() => verifyRelease(files, keys.publicKeyPem)).toThrow(/signature/i);
});
