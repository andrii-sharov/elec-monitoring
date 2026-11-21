import { describe, expect, it } from 'vitest';
import { isValidToken } from '../src/auth.js';

describe('isValidToken', () => {
  const token = 'secret-token';

  it('accepts the right bearer token', () => {
    expect(isValidToken(`Bearer ${token}`, token)).toBe(true);
  });

  it.each([
    ['wrong token', 'Bearer secret-tokeX'],
    ['different length', 'Bearer short'],
    ['no Bearer prefix', token],
    ['missing header', undefined],
    ['empty bearer', 'Bearer '],
  ])('rejects %s', (_name, header) => {
    expect(isValidToken(header, token)).toBe(false);
  });
});
