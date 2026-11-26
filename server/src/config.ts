import { z } from 'zod';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const localHosts = new Set(['localhost', '127.0.0.1']);

const originUrl = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    const secure =
      url.protocol === 'https:' || (url.protocol === 'http:' && localHosts.has(url.hostname));
    return secure && url.pathname === '/' && url.search === '' && url.hash === '';
  })
  .transform((value) => new URL(value).origin);

const databaseEnvSchema = z.object({ DATABASE_URL: postgresUrl });

const firmwareEnvShape = {
  FIRMWARE_STORE: z.enum(['supabase', 'fs']).default('supabase'),
  SUPABASE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((value) => new URL(value).origin)
    .optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  FIRMWARE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .default('firmware'),
  FIRMWARE_DIR: z.string().min(1).optional(),
};

type FirmwareEnv = z.output<z.ZodObject<typeof firmwareEnvShape>>;

function requireFirmwareKeys(env: FirmwareEnv, ctx: z.RefinementCtx): void {
  const required =
    env.FIRMWARE_STORE === 'supabase'
      ? (['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const)
      : (['FIRMWARE_DIR'] as const);
  for (const key of required) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required' });
  }
}

const firmwareReleaseEnvSchema = databaseEnvSchema
  .extend(firmwareEnvShape)
  .superRefine(requireFirmwareKeys);

const telegramEnvShape = {
  TELEGRAM_TRANSPORT: z.enum(['telegram', 'log']).default('telegram'),
  TELEGRAM_PLATFORM_BOT_TOKEN: z.string().min(1).optional(),
};

type TelegramEnv = z.output<z.ZodObject<typeof telegramEnvShape>>;

function requireBotToken(env: TelegramEnv, ctx: z.RefinementCtx): void {
  if (env.TELEGRAM_TRANSPORT === 'telegram' && !env.TELEGRAM_PLATFORM_BOT_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['TELEGRAM_PLATFORM_BOT_TOKEN'], message: 'Required' });
  }
}

const encryptionKeySchema = z
  .base64()
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === 32);

const emailEnvShape = {
  EMAIL_TRANSPORT: z.enum(['resend', 'log']).default('resend'),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1),
};

type EmailEnv = z.output<z.ZodObject<typeof emailEnvShape>>;

function requireResendKey(env: EmailEnv, ctx: z.RefinementCtx): void {
  if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'Required' });
  }
}

const workerEnvSchema = databaseEnvSchema
  .extend({
    ENCRYPTION_KEY: encryptionKeySchema,
    CLIENT_URL: originUrl,
    ...emailEnvShape,
    ...telegramEnvShape,
  })
  .superRefine((env, ctx) => {
    requireBotToken(env, ctx);
    requireResendKey(env, ctx);
  });

const envSchema = databaseEnvSchema
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).optional(),
    JWT_SECRET: z.string().min(32),
    ENCRYPTION_KEY: encryptionKeySchema,
    CLIENT_URL: originUrl,
    ADMIN_URL: originUrl,
    API_URL: originUrl,
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    ...emailEnvShape,
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    TELEGRAM_PLATFORM_BOT_USERNAME: z
      .string()
      .transform((value) => value.replace(/^@/, ''))
      .pipe(z.string().regex(/^[A-Za-z0-9_]{5,32}$/)),
    TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    ...telegramEnvShape,
    ...firmwareEnvShape,
  })
  .superRefine((env, ctx) => {
    requireFirmwareKeys(env, ctx);
    requireBotToken(env, ctx);
    requireResendKey(env, ctx);
  });

export type AppUrls = { client: string; admin: string; api: string };

export type EmailConfig =
  | { transport: 'resend'; resendApiKey: string; from: string }
  | { transport: 'log'; from: string };

export type FirmwareStoreConfig =
  | { store: 'supabase'; url: string; secretKey: string; bucket: string }
  | { store: 'fs'; dir: string };

export type TelegramTransportConfig =
  | { transport: 'telegram'; botToken: string }
  | { transport: 'log' };

export type Config = {
  databaseUrl: string;
  port: number;
  host?: string;
  jwtSecret: string;
  encryptionKey: Buffer;
  urls: AppUrls;
  google: { clientId: string; clientSecret: string };
  email: EmailConfig;
  trustProxyHops: number;
  telegram: { botUsername: string; webhookSecret: string } & TelegramTransportConfig;
  firmware: FirmwareStoreConfig;
};

export type DatabaseConfig = { databaseUrl: string };

export type FirmwareReleaseConfig = { databaseUrl: string; firmware: FirmwareStoreConfig };

export type WorkerConfig = {
  databaseUrl: string;
  telegram: TelegramTransportConfig;
  encryptionKey: Buffer;
  urls: Pick<AppUrls, 'client'>;
  email: EmailConfig;
};

export class ConfigError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super(`Invalid environment: ${keys.join(', ')}`);
    this.name = 'ConfigError';
    this.keys = keys;
  }
}

function failedKeys(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0])))].toSorted();
}

function toEmailConfig(env: EmailEnv): EmailConfig {
  if (env.EMAIL_TRANSPORT === 'log') return { transport: 'log', from: env.EMAIL_FROM };
  return {
    transport: 'resend',
    resendApiKey: env.RESEND_API_KEY ?? '',
    from: env.EMAIL_FROM,
  };
}

function toFirmwareConfig(env: FirmwareEnv): FirmwareStoreConfig {
  if (env.FIRMWARE_STORE === 'fs') return { store: 'fs', dir: env.FIRMWARE_DIR ?? '' };
  return {
    store: 'supabase',
    url: env.SUPABASE_URL ?? '',
    secretKey: env.SUPABASE_SECRET_KEY ?? '',
    bucket: env.FIRMWARE_BUCKET,
  };
}

function toTelegramTransport(env: TelegramEnv): TelegramTransportConfig {
  if (env.TELEGRAM_TRANSPORT === 'log') return { transport: 'log' };
  return { transport: 'telegram', botToken: env.TELEGRAM_PLATFORM_BOT_TOKEN ?? '' };
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new ConfigError(failedKeys(result.error));
  const data = result.data;
  return {
    databaseUrl: data.DATABASE_URL,
    port: data.PORT,
    host: data.HOST,
    jwtSecret: data.JWT_SECRET,
    encryptionKey: data.ENCRYPTION_KEY,
    urls: { client: data.CLIENT_URL, admin: data.ADMIN_URL, api: data.API_URL },
    google: {
      clientId: data.GOOGLE_CLIENT_ID,
      clientSecret: data.GOOGLE_CLIENT_SECRET,
    },
    email: toEmailConfig(data),
    trustProxyHops: data.TRUST_PROXY_HOPS,
    telegram: {
      botUsername: data.TELEGRAM_PLATFORM_BOT_USERNAME,
      webhookSecret: data.TELEGRAM_WEBHOOK_SECRET,
      ...toTelegramTransport(data),
    },
    firmware: toFirmwareConfig(data),
  };
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const result = databaseEnvSchema.safeParse(env);
  if (!result.success) throw new ConfigError(failedKeys(result.error));
  return { databaseUrl: result.data.DATABASE_URL };
}

export function loadFirmwareReleaseConfig(env: NodeJS.ProcessEnv): FirmwareReleaseConfig {
  const result = firmwareReleaseEnvSchema.safeParse(env);
  if (!result.success) throw new ConfigError(failedKeys(result.error));
  return { databaseUrl: result.data.DATABASE_URL, firmware: toFirmwareConfig(result.data) };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const result = workerEnvSchema.safeParse(env);
  if (!result.success) throw new ConfigError(failedKeys(result.error));
  const data = result.data;
  return {
    databaseUrl: data.DATABASE_URL,
    telegram: toTelegramTransport(data),
    encryptionKey: data.ENCRYPTION_KEY,
    urls: { client: data.CLIENT_URL },
    email: toEmailConfig(data),
  };
}

function exitOnConfigError<T>(load: () => T): T {
  try {
    return load();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}

export function loadConfigOrExit(env: NodeJS.ProcessEnv): Config {
  return exitOnConfigError(() => loadConfig(env));
}

export function loadDatabaseConfigOrExit(env: NodeJS.ProcessEnv): DatabaseConfig {
  return exitOnConfigError(() => loadDatabaseConfig(env));
}

export function loadWorkerConfigOrExit(env: NodeJS.ProcessEnv): WorkerConfig {
  return exitOnConfigError(() => loadWorkerConfig(env));
}

export function loadFirmwareReleaseConfigOrExit(env: NodeJS.ProcessEnv): FirmwareReleaseConfig {
  return exitOnConfigError(() => loadFirmwareReleaseConfig(env));
}
