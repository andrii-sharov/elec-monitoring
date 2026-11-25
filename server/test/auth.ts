import { hashPassword } from '../src/auth/password.ts';
import { createSession } from '../src/auth/sessions.ts';
import { signAccessToken } from '../src/auth/jwt.ts';
import type { Db } from '../src/db/client.ts';
import { appUser } from '../src/db/schema/index.ts';
import type { AppDeps } from '../src/http/app.ts';
import type { User } from '../src/http/auth/middleware.ts';

export const TEST_PASSWORD = 'correct horse 1';

const defaultPasswordHash = hashPassword(TEST_PASSWORD);

export async function createUser(
  db: Db,
  overrides: Partial<typeof appUser.$inferInsert> & {
    password?: string;
    phoneVerified?: boolean;
  } = {},
): Promise<User> {
  const { password, phoneVerified = true, ...columns } = overrides;
  const verifiedAt = new Date('2026-11-01T10:00:00Z');
  const identifier = columns.phone
    ? { email: null, phoneVerifiedAt: phoneVerified ? verifiedAt : null }
    : { email: 'john@example.com', emailVerifiedAt: verifiedAt };
  const passwordHash =
    'passwordHash' in columns
      ? columns.passwordHash
      : password === undefined
        ? await defaultPasswordHash
        : await hashPassword(password);
  const [user] = await db
    .insert(appUser)
    .values({
      ...identifier,
      name: 'John',
      ...columns,
      passwordHash,
    })
    .returning();
  return user!;
}

export async function signIn(
  deps: Pick<AppDeps, 'db' | 'clock' | 'config'>,
  userId: string,
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const { sessionId, refreshToken } = await createSession(deps.db, deps.clock, userId);
  const accessToken = await signAccessToken(deps.config.jwtSecret, deps.clock, {
    userId,
    sessionId,
  });
  return { accessToken, refreshToken, sessionId };
}
