import { expect, test } from 'vitest';
import {
  ConfigError,
  loadConfig,
  loadDatabaseConfig,
  loadFirmwareReleaseConfig,
  loadWorkerConfig,
} from './config.ts';

function catchError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected ConfigError');
}

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://u:p@h:5432/db',
  PORT: '8080',
  JWT_SECRET: 'x'.repeat(32),
  CLIENT_URL: 'https://example.com',
  ADMIN_URL: 'https://admin.example.com',
  API_URL: 'https://api.example.com',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  RESEND_API_KEY: 're_123',
  EMAIL_FROM: 'Electricity Monitor <noreply@example.com>',
  TELEGRAM_PLATFORM_BOT_USERNAME: 'ElecBot',
  TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(32),
  TELEGRAM_PLATFORM_BOT_TOKEN: '123:abc',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_x',
};

test('loads valid env', () => {
  expect(loadConfig(validEnv)).toEqual({
    databaseUrl: 'postgres://u:p@h:5432/db',
    port: 8080,
    jwtSecret: 'x'.repeat(32),
    urls: {
      client: 'https://example.com',
      admin: 'https://admin.example.com',
      api: 'https://api.example.com',
    },
    google: { clientId: 'gid', clientSecret: 'gsecret' },
    email: {
      transport: 'resend',
      resendApiKey: 're_123',
      from: 'Electricity Monitor <noreply@example.com>',
    },
    trustProxyHops: 0,
    telegram: {
      botUsername: 'ElecBot',
      webhookSecret: 'w'.repeat(32),
      transport: 'telegram',
      botToken: '123:abc',
    },
    firmware: {
      store: 'supabase',
      url: 'https://proj.supabase.co',
      secretKey: 'sb_secret_x',
      bucket: 'firmware',
    },
  });
});

test('the supabase firmware store needs its URL and secret key', () => {
  const err = catchError(() =>
    loadConfig({ ...validEnv, SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined }),
  );
  expect(err.keys).toEqual(['SUPABASE_SECRET_KEY', 'SUPABASE_URL']);
});

test('FIRMWARE_BUCKET overrides the bucket', () => {
  const config = loadConfig({ ...validEnv, FIRMWARE_BUCKET: 'fw-test' });
  expect(config.firmware).toMatchObject({ store: 'supabase', bucket: 'fw-test' });
});

test('the fs firmware store needs FIRMWARE_DIR and no Supabase keys', () => {
  const env = { ...validEnv, SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined };
  expect(catchError(() => loadConfig({ ...env, FIRMWARE_STORE: 'fs' })).keys).toEqual([
    'FIRMWARE_DIR',
  ]);
  expect(loadConfig({ ...env, FIRMWARE_STORE: 'fs', FIRMWARE_DIR: '/tmp/fw' }).firmware).toEqual({
    store: 'fs',
    dir: '/tmp/fw',
  });
});

test('rejects an unknown FIRMWARE_STORE', () => {
  expect(catchError(() => loadConfig({ ...validEnv, FIRMWARE_STORE: 's3' })).keys).toEqual([
    'FIRMWARE_STORE',
  ]);
});

test('PORT defaults to 3000, EMAIL_TRANSPORT to resend, TRUST_PROXY_HOPS to 0', () => {
  const config = loadConfig({ ...validEnv, PORT: undefined });
  expect(config.port).toBe(3000);
  expect(config.email.transport).toBe('resend');
  expect(config.trustProxyHops).toBe(0);
});

test('lists every invalid key without printing values', () => {
  const err = catchError(() => loadConfig({ ...validEnv, PORT: 'abc', DATABASE_URL: 'not a url' }));
  expect(err.keys).toEqual(['DATABASE_URL', 'PORT']);
  expect(err.message).toBe('Invalid environment: DATABASE_URL, PORT');
  expect(err.message).not.toContain('not a url');
});

test('missing DATABASE_URL fails', () => {
  expect(catchError(() => loadConfig({ ...validEnv, DATABASE_URL: undefined })).keys).toEqual([
    'DATABASE_URL',
  ]);
});

test('rejects a non-Postgres URL', () => {
  expect(
    catchError(() => loadConfig({ ...validEnv, DATABASE_URL: 'https://example.com' })).keys,
  ).toEqual(['DATABASE_URL']);
});

test('strips a trailing slash from app URLs', () => {
  expect(loadConfig({ ...validEnv, CLIENT_URL: 'https://example.com/' }).urls.client).toBe(
    'https://example.com',
  );
});

test('requires https except for localhost', () => {
  expect(
    catchError(() => loadConfig({ ...validEnv, CLIENT_URL: 'http://example.com' })).keys,
  ).toEqual(['CLIENT_URL']);
  expect(loadConfig({ ...validEnv, CLIENT_URL: 'http://localhost:5173' }).urls.client).toBe(
    'http://localhost:5173',
  );
  expect(loadConfig({ ...validEnv, CLIENT_URL: 'http://127.0.0.1:5173' }).urls.client).toBe(
    'http://127.0.0.1:5173',
  );
});

test('rejects an app URL with a path, query or hash', () => {
  for (const value of [
    'https://example.com/app',
    'https://example.com/?a=1',
    'https://example.com/#x',
  ]) {
    expect(catchError(() => loadConfig({ ...validEnv, CLIENT_URL: value })).keys).toEqual([
      'CLIENT_URL',
    ]);
  }
});

test('JWT_SECRET needs 32 characters and is never printed', () => {
  const secret = 'y'.repeat(31);
  const err = catchError(() => loadConfig({ ...validEnv, JWT_SECRET: secret }));
  expect(err.keys).toEqual(['JWT_SECRET']);
  expect(err.message).not.toContain(secret);
});

test('RESEND_API_KEY is required only for the resend transport', () => {
  expect(catchError(() => loadConfig({ ...validEnv, RESEND_API_KEY: undefined })).keys).toEqual([
    'RESEND_API_KEY',
  ]);
  const config = loadConfig({
    ...validEnv,
    EMAIL_TRANSPORT: 'log',
    RESEND_API_KEY: undefined,
  });
  expect(config.email).toEqual({ transport: 'log', from: validEnv.EMAIL_FROM });
});

test('the API needs a bot token only for the telegram transport', () => {
  const env = { ...validEnv, TELEGRAM_PLATFORM_BOT_TOKEN: undefined };
  expect(catchError(() => loadConfig({ ...env, TELEGRAM_TRANSPORT: 'telegram' })).keys).toEqual([
    'TELEGRAM_PLATFORM_BOT_TOKEN',
  ]);
  expect(loadConfig({ ...env, TELEGRAM_TRANSPORT: 'log' }).telegram).toMatchObject({
    transport: 'log',
  });
});

test('HOST is optional and passed through', () => {
  expect(loadConfig(validEnv).host).toBeUndefined();
  expect(loadConfig({ ...validEnv, HOST: '127.0.0.1' }).host).toBe('127.0.0.1');
});

test('rejects an empty HOST', () => {
  expect(catchError(() => loadConfig({ ...validEnv, HOST: '' })).keys).toEqual(['HOST']);
});

test('TRUST_PROXY_HOPS is read as an integer', () => {
  expect(loadConfig({ ...validEnv, TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1);
});

test('loadDatabaseConfig needs only DATABASE_URL', () => {
  expect(loadDatabaseConfig({ DATABASE_URL: 'postgres://h/db' })).toEqual({
    databaseUrl: 'postgres://h/db',
  });
  expect(catchError(() => loadDatabaseConfig({})).keys).toEqual(['DATABASE_URL']);
});

test('worker config requires a bot token for the telegram transport', () => {
  const err = catchError(() => loadWorkerConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db' }));
  expect(err.keys).toEqual(['TELEGRAM_PLATFORM_BOT_TOKEN']);
});

test('worker config with the telegram transport', () => {
  expect(
    loadWorkerConfig({
      DATABASE_URL: 'postgres://u:p@h:5432/db',
      TELEGRAM_PLATFORM_BOT_TOKEN: '123:abc',
    }),
  ).toEqual({
    databaseUrl: 'postgres://u:p@h:5432/db',
    telegram: { transport: 'telegram', botToken: '123:abc' },
  });
});

test('worker config with the log transport needs no token or auth secrets', () => {
  expect(
    loadWorkerConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db', TELEGRAM_TRANSPORT: 'log' }),
  ).toEqual({ databaseUrl: 'postgres://u:p@h:5432/db', telegram: { transport: 'log' } });
});

test('worker config rejects an unknown transport', () => {
  const err = catchError(() =>
    loadWorkerConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db', TELEGRAM_TRANSPORT: 'smoke' }),
  );
  expect(err.keys).toEqual(['TELEGRAM_TRANSPORT']);
});

test('strips a leading @ from the bot username', () => {
  expect(
    loadConfig({ ...validEnv, TELEGRAM_PLATFORM_BOT_USERNAME: '@ElecBot' }).telegram.botUsername,
  ).toBe('ElecBot');
});

test.each([
  ['TELEGRAM_WEBHOOK_SECRET', undefined],
  ['TELEGRAM_WEBHOOK_SECRET', 'w'.repeat(31)],
  ['TELEGRAM_WEBHOOK_SECRET', `${'w'.repeat(31)}/`],
  ['TELEGRAM_PLATFORM_BOT_USERNAME', undefined],
  ['TELEGRAM_PLATFORM_BOT_USERNAME', 'bad'],
])('rejects %s = %s', (key, value) => {
  expect(catchError(() => loadConfig({ ...validEnv, [key]: value })).keys).toEqual([key]);
});

test('the firmware release script needs only the database and the store', () => {
  expect(
    loadFirmwareReleaseConfig({
      DATABASE_URL: 'postgres://u:p@h:5432/db',
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_x',
    }),
  ).toEqual({
    databaseUrl: 'postgres://u:p@h:5432/db',
    firmware: {
      store: 'supabase',
      url: 'https://proj.supabase.co',
      secretKey: 'sb_secret_x',
      bucket: 'firmware',
    },
  });
  expect(
    catchError(() => loadFirmwareReleaseConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db' })).keys,
  ).toEqual(['SUPABASE_SECRET_KEY', 'SUPABASE_URL']);
});

test('SUPABASE_URL keeps only the origin', () => {
  const config = loadConfig({ ...validEnv, SUPABASE_URL: 'https://proj.supabase.co/rest/v1/' });
  expect(config.firmware).toMatchObject({ url: 'https://proj.supabase.co' });
});
