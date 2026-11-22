import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUIDv7,
} from 'node:crypto';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function newId(): string {
  return randomUUIDv7();
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
}

export function encrypt(key: Buffer, plaintext: string): Buffer {
  assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

export function decrypt(key: Buffer, blob: Buffer): string {
  assertKey(key);
  if (blob.length < NONCE_BYTES + TAG_BYTES) throw new Error('Encrypted value is too short');
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
