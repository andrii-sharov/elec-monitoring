import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { sha256 } from '../lib/crypto.ts';
import {
  appUser,
  device,
  notificationChannel,
  outage,
  refreshToken,
  session,
} from './schema/index.ts';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

async function expectViolation(query: PromiseLike<unknown>, constraint: string) {
  const err: unknown = await Promise.resolve(query).then(
    () => undefined,
    (e: unknown) => e,
  );
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  expect(cause instanceof Error ? cause.message : String(cause)).toContain(constraint);
}

async function rows<T>(query: string): Promise<T[]> {
  return (await t.client.query<T>(query)).rows;
}

let emailSeq = 0;
async function insertUser() {
  const [user] = await t.db
    .insert(appUser)
    .values({ email: `john${++emailSeq}@example.com`, name: 'John', passwordHash: 'x' })
    .returning();
  return user!;
}

async function insertDevice() {
  const user = await insertUser();
  const [row] = await t.db.insert(device).values({ ownerId: user.id, name: 'Home' }).returning();
  return row!;
}

describe('migrations', () => {
  test('create every table', async () => {
    const tables = await rows<{ relname: string }>(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    );
    expect(tables.map((r) => r.relname)).toEqual([
      'api_token',
      'app_user',
      'delivery',
      'device',
      'device_boot',
      'device_channel',
      'device_diagnostic',
      'device_invite',
      'device_viewer',
      'firmware_release',
      'firmware_update_attempt',
      'notification_channel',
      'one_time_token',
      'outage',
      'refresh_token',
      'session',
      'worker_heartbeat',
    ]);
  });

  test('enable RLS on every table with no policies', async () => {
    const withoutRls = await rows(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    );
    expect(withoutRls).toEqual([]);
    expect(await rows('select * from pg_policies')).toEqual([]);
  });

  test('index every foreign key column', async () => {
    const unindexed = await rows<{ fk: string }>(`
      select c.conname as fk
      from pg_constraint c
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
        )
    `);
    expect(unindexed).toEqual([]);
  });
});

describe('constraints', () => {
  test('ids are UUIDv7', async () => {
    const user = await insertUser();
    expect(user.id[14]).toBe('7');
  });

  test('emails must be lowercase', async () => {
    await expectViolation(
      t.db.insert(appUser).values({ email: 'John@Example.com', name: 'John', passwordHash: 'x' }),
      'app_user_email_check',
    );
  });

  test('a user needs a sign-in method', async () => {
    await expectViolation(
      t.db.insert(appUser).values({ email: 'nomethod@example.com', name: 'John' }),
      'app_user_sign_in_method_check',
    );
  });

  test('ONLINE devices need offline_at and others must not have it', async () => {
    const user = await insertUser();
    await expectViolation(
      t.db.insert(device).values({ ownerId: user.id, name: 'Home', state: 'ONLINE' }),
      'device_online_offline_at_check',
    );
    await expectViolation(
      t.db.insert(device).values({ ownerId: user.id, name: 'Home', offlineAt: new Date() }),
      'device_online_offline_at_check',
    );
    const [pending] = await t.db
      .insert(device)
      .values({ ownerId: user.id, name: 'Home' })
      .returning();
    expect(pending!.state).toBe('PENDING');
  });

  test('one open outage per device', async () => {
    const d = await insertDevice();
    const startedAt = new Date('2026-11-21T10:00:00Z');
    await t.db.insert(outage).values({ deviceId: d.id, type: 'OUTAGE', startedAt });
    await expectViolation(
      t.db.insert(outage).values({ deviceId: d.id, type: 'OUTAGE', startedAt }),
      'outage_one_open_per_device',
    );
  });

  test('duration_s is generated from the outage times', async () => {
    const d = await insertDevice();
    const [row] = await t.db
      .insert(outage)
      .values({
        deviceId: d.id,
        type: 'OUTAGE',
        startedAt: new Date('2026-11-21T10:00:00Z'),
        endedAt: new Date('2026-11-21T10:01:30Z'),
        cause: 'POWER',
        kind: 'SHORT',
      })
      .returning();
    expect(row!.durationS).toBe(90);
  });

  test('channel columns must match the channel type', async () => {
    const user = await insertUser();
    await expectViolation(
      t.db.insert(notificationChannel).values({
        userId: user.id,
        type: 'WEBHOOK',
        name: 'Hook',
        webhookUrl: 'https://example.com/hook',
        webhookEvents: ['device.offline'],
        webhookSecretEnc: Buffer.alloc(40),
        telegramChatId: 42n,
      }),
      'notification_channel_type_columns_check',
    );
    const [platform] = await t.db
      .insert(notificationChannel)
      .values({ userId: user.id, type: 'TELEGRAM_PLATFORM', name: 'Chat', telegramChatId: 42n })
      .returning();
    expect(platform!.telegramChatId).toBe(42n);
  });

  test('bytea round-trips as a Buffer and token hashes are 32 bytes', async () => {
    const user = await insertUser();
    const [s] = await t.db.insert(session).values({ userId: user.id }).returning();
    const hash = sha256('x');
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    await t.db.insert(refreshToken).values({ tokenHash: hash, sessionId: s!.id, expiresAt });
    const [stored] = await t.db.select().from(refreshToken).where(eq(refreshToken.tokenHash, hash));
    expect(Buffer.isBuffer(stored!.tokenHash)).toBe(true);
    expect(stored!.tokenHash.equals(hash)).toBe(true);
    await expectViolation(
      t.db
        .insert(refreshToken)
        .values({ tokenHash: Buffer.alloc(16), sessionId: s!.id, expiresAt }),
      'refresh_token_token_hash_check',
    );
  });
});
