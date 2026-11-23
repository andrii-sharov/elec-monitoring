import { randomBytes, randomInt } from 'node:crypto';
import { sha256 } from '../lib/crypto.ts';

const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PAIRING_CODE_LENGTH = 8;
const DEVICE_TOKEN_FORMAT = /^[0-9a-f]{64}$/;

export const PAIRING_CODE_TTL_MS = 1_800_000;

export function newPairingCode(): string {
  return Array.from(
    { length: PAIRING_CODE_LENGTH },
    () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)],
  ).join('');
}

export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function hashPairingCode(code: string): Buffer {
  return sha256(normalizePairingCode(code));
}

export function newDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

export function isDeviceTokenFormat(token: string): boolean {
  return DEVICE_TOKEN_FORMAT.test(token);
}

export function hashDeviceToken(token: string): Buffer {
  return sha256(token);
}
