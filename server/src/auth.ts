import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export function isValidToken(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(sha256(header.slice('Bearer '.length)), sha256(expected));
}
