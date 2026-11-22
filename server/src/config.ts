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

const envSchema = databaseEnvSchema
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    JWT_SECRET: z.string().min(32),
    CLIENT_URL: originUrl,
    ADMIN_URL: originUrl,
    API_URL: originUrl,
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    EMAIL_TRANSPORT: z.enum(['resend', 'log']).default('resend'),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'Required',
      });
    }
  });

export type AppUrls = { client: string; admin: string; api: string };

export type EmailConfig =
  | { transport: 'resend'; resendApiKey: string; from: string }
  | { transport: 'log'; from: string };

export type Config = {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  urls: AppUrls;
  google: { clientId: string; clientSecret: string };
  email: EmailConfig;
  trustProxyHops: number;
};

export type DatabaseConfig = { databaseUrl: string };

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

function toEmailConfig(env: z.output<typeof envSchema>): EmailConfig {
  if (env.EMAIL_TRANSPORT === 'log') return { transport: 'log', from: env.EMAIL_FROM };
  return {
    transport: 'resend',
    resendApiKey: env.RESEND_API_KEY ?? '',
    from: env.EMAIL_FROM,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new ConfigError(failedKeys(result.error));
  const data = result.data;
  return {
    databaseUrl: data.DATABASE_URL,
    port: data.PORT,
    jwtSecret: data.JWT_SECRET,
    urls: { client: data.CLIENT_URL, admin: data.ADMIN_URL, api: data.API_URL },
    google: {
      clientId: data.GOOGLE_CLIENT_ID,
      clientSecret: data.GOOGLE_CLIENT_SECRET,
    },
    email: toEmailConfig(data),
    trustProxyHops: data.TRUST_PROXY_HOPS,
  };
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const result = databaseEnvSchema.safeParse(env);
  if (!result.success) throw new ConfigError(failedKeys(result.error));
  return { databaseUrl: result.data.DATABASE_URL };
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
