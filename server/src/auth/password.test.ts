import { argon2Sync, randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { hashPassword, verifyDummyPassword, verifyPassword } from './password.ts';

const PHC_PATTERN = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

test('hashPassword produces a salted argon2id PHC string', async () => {
  const first = await hashPassword('correct horse 1');
  const second = await hashPassword('correct horse 1');
  expect(first).toMatch(PHC_PATTERN);
  expect(first).not.toBe(second);
});

test('verifyPassword accepts only the right password', async () => {
  const hash = await hashPassword('correct horse 1');
  expect(await verifyPassword('correct horse 1', hash)).toBe(true);
  expect(await verifyPassword('wrong horse 1', hash)).toBe(false);
  expect(await verifyPassword('', hash)).toBe(false);
  expect(await verifyPassword('Correct horse 1', hash)).toBe(false);
});

test('verifyPassword reads parameters from the hash', async () => {
  const salt = randomBytes(16);
  const tag = argon2Sync('argon2id', {
    message: 'old password',
    nonce: salt,
    parallelism: 1,
    tagLength: 32,
    memory: 8192,
    passes: 1,
  });
  const hash = `$argon2id$v=19$m=8192,t=1,p=1$${b64(salt)}$${b64(tag)}`;
  expect(await verifyPassword('old password', hash)).toBe(true);
  expect(await verifyPassword('other', hash)).toBe(false);
});

test('verifyPassword returns false for malformed hashes', async () => {
  const valid = await hashPassword('x');
  const malformed = [
    '',
    valid.replace('argon2id', 'argon2i'),
    '$argon2id$v=19$m=19456,t=2,p=1$onlysalt',
    `${valid}$extra`,
    valid.replace('v=19', 'v=16'),
    '$argon2id$v=19$m=abc,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAA',
    '$argon2id$v=19$m=19456,t=2,p=1$***$***',
  ];
  for (const hash of malformed) {
    expect(await verifyPassword('x', hash)).toBe(false);
  }
});

test('verifyDummyPassword resolves false', async () => {
  expect(await verifyDummyPassword('x')).toBe(false);
});
