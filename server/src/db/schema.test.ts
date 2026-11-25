import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { sha256 } from '../lib/crypto.ts';
import {
  appUser,
  device,
  deviceBoot,
  deviceDiagnostic,
  deviceInvite,
  firmwareRelease,
  firmwareUpdateAttempt,
  notificationChannel,
  oneTimeToken,
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
      'rate_limit_bucket',
      'refresh_token',
      'session',
      'worker_heartbeat',
    ]);
  });

  test('has no api_token table', async () => {
    expect(
      await rows(`select 1 from information_schema.tables where table_name = 'api_token'`),
    ).toEqual([]);
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
            and (
              i.indpred is null
              or pg_get_expr(i.indpred, i.indrelid) = format(
                '(%I IS NOT NULL)',
                (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1])
              )
            )
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

  test('a user needs an email or a phone', async () => {
    await expectViolation(
      t.db.insert(appUser).values({ name: 'John', passwordHash: 'x' }),
      'app_user_identifier_check',
    );
    const [user] = await t.db
      .insert(appUser)
      .values({ phone: '+380501234500', name: 'John', passwordHash: 'x' })
      .returning();
    expect(user!.email).toBeNull();
  });

  test('phones and Telegram users are unique', async () => {
    const base = { name: 'John', passwordHash: 'x' };
    await t.db.insert(appUser).values({ ...base, phone: '+380501234501', telegramUserId: 777n });
    await expectViolation(
      t.db.insert(appUser).values({ ...base, phone: '+380501234501' }),
      'app_user_phone_key',
    );
    await expectViolation(
      t.db.insert(appUser).values({ ...base, phone: '+380501234502', telegramUserId: 777n }),
      'app_user_telegram_user_id_key',
    );
  });

  test('an invite has exactly one of email or phone, one pending per phone', async () => {
    const d = await insertDevice();
    let seq = 0;
    const invite = (values: { email?: string; phone?: string; acceptedAt?: Date }) =>
      t.db.insert(deviceInvite).values({
        deviceId: d.id,
        invitedBy: d.ownerId,
        tokenHash: sha256(`invite-${++seq}`),
        expiresAt: new Date('2026-12-01T00:00:00Z'),
        ...values,
      });
    await expectViolation(invite({}), 'device_invite_one_identifier_check');
    await expectViolation(
      invite({ email: 'john@example.com', phone: '+380501234503' }),
      'device_invite_one_identifier_check',
    );
    await invite({ phone: '+380501234503', acceptedAt: new Date('2026-11-21T10:00:00Z') });
    await invite({ phone: '+380501234503' });
    await expectViolation(invite({ phone: '+380501234503' }), 'device_invite_pending_phone_key');
  });

  test.each(['PHONE_VERIFY', 'PHONE_RECOVER'])('one_time_token accepts %s', async (purpose) => {
    const user = await insertUser();
    const values = {
      tokenHash: sha256(purpose),
      userId: user.id,
      purpose,
      phone: '+380501234567',
      telegramUserId: 777n,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    };
    const [stored] = await t.db.insert(oneTimeToken).values(values).returning();
    expect(stored!.purpose).toBe(purpose);
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

  test('API diagnostics have no Wi-Fi reason code', async () => {
    const d = await insertDevice();
    const bootId = '01970000-0000-7000-8000-000000000001';
    await t.db.insert(deviceBoot).values({ deviceId: d.id, bootId, resetReason: 'POWER_ON' });
    const record = {
      deviceId: d.id,
      bootId,
      startUptimeS: 10,
      endUptimeS: 20,
      startedAt: new Date('2026-11-21T10:00:00Z'),
      endedAt: new Date('2026-11-21T10:00:10Z'),
    };
    await expectViolation(
      t.db.insert(deviceDiagnostic).values({ ...record, localId: 1, kind: 'API', reason: 15 }),
      'device_diagnostic_reason_check',
    );
    await t.db.insert(deviceDiagnostic).values({ ...record, localId: 2, kind: 'WIFI', reason: 15 });
  });

  test('queued update attempts have not started', async () => {
    const d = await insertDevice();
    const [release] = await t.db
      .insert(firmwareRelease)
      .values({
        version: '2.1.0',
        versionCode: 20100,
        sizeBytes: 1,
        sha256: sha256('image'),
        signature: Buffer.alloc(64),
        imagePath: 'firmware/2.1.0.bin',
      })
      .returning();
    await expectViolation(
      t.db.insert(firmwareUpdateAttempt).values({
        deviceId: d.id,
        releaseId: release!.id,
        startedAt: new Date('2026-11-21T10:00:00Z'),
        windowEndsAt: new Date('2026-11-21T10:10:00Z'),
      }),
      'firmware_update_attempt_queued_check',
    );
  });
});
