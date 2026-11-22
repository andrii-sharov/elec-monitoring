import { describe, expect, test } from 'vitest';
import { decrypt, encrypt, newId, randomToken, sha256 } from './crypto.ts';

describe('newId', () => {
  test('is a UUIDv7', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('starts with the current time in milliseconds', () => {
    const ms = parseInt(newId().replaceAll('-', '').slice(0, 12), 16);
    expect(Math.abs(ms - Date.now())).toBeLessThan(1000);
  });
});

describe('randomToken', () => {
  test('is 32 random bytes in base64url', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  test('differs between calls', () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe('sha256', () => {
  test('matches the standard test vector', () => {
    expect(sha256('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('hashes buffers to 32 bytes', () => {
    expect(sha256(Buffer.from('abc'))).toEqual(sha256('abc'));
    expect(sha256('')).toHaveLength(32);
  });
});

describe('encrypt / decrypt', () => {
  const key = Buffer.alloc(32, 7);
  const text = 'secret ✓';

  test('round-trips', () => {
    expect(decrypt(key, encrypt(key, text))).toBe(text);
  });

  test('stores nonce || ciphertext || tag', () => {
    expect(encrypt(key, text)).toHaveLength(12 + Buffer.byteLength(text) + 16);
  });

  test('uses a fresh nonce each time', () => {
    expect(encrypt(key, text).equals(encrypt(key, text))).toBe(false);
  });

  test.each([0, 12, 20])('rejects a tampered byte at %i', (index) => {
    const blob = encrypt(key, text);
    blob[index] = (blob[index] ?? 0) ^ 1;
    expect(() => decrypt(key, blob)).toThrow('unable to authenticate');
  });

  test('rejects a tampered tag', () => {
    const blob = encrypt(key, text);
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 1;
    expect(() => decrypt(key, blob)).toThrow('unable to authenticate');
  });

  test('rejects the wrong key', () => {
    expect(() => decrypt(Buffer.alloc(32, 8), encrypt(key, text))).toThrow(
      'unable to authenticate',
    );
  });

  test('rejects a key that is not 32 bytes', () => {
    expect(() => encrypt(Buffer.alloc(16), text)).toThrow('32 bytes');
    expect(() => decrypt(Buffer.alloc(16), encrypt(key, text))).toThrow('32 bytes');
  });

  test('rejects a blob shorter than nonce and tag', () => {
    expect(() => decrypt(key, Buffer.alloc(27))).toThrow('too short');
  });
});
