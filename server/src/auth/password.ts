import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function encode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '');
}

function derive(
  password: string,
  salt: Buffer,
  params: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return argon2Async('argon2id', { message: password, nonce: salt, ...params });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, {
    memory: MEMORY_KIB,
    passes: PASSES,
    parallelism: PARALLELISM,
    tagLength: TAG_BYTES,
  });
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${encode(salt)}$${encode(tag)}`;
}

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(phc);
  if (!match) return false;
  const [, memory, passes, parallelism, saltB64, tagB64] = match;
  const salt = Buffer.from(saltB64 ?? '', 'base64');
  const expected = Buffer.from(tagB64 ?? '', 'base64');
  if (salt.length < 8 || expected.length < 4) return false;
  try {
    const actual = await derive(password, salt, {
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
      tagLength: expected.length,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const dummyHash = hashPassword('dummy-password-for-timing');

export async function verifyDummyPassword(password: string): Promise<false> {
  await verifyPassword(password, await dummyHash);
  return false;
}
