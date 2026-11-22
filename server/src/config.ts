import { z } from 'zod';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Config = { databaseUrl: string; port: number };

export class ConfigError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super(`Invalid environment: ${keys.join(', ')}`);
    this.name = 'ConfigError';
    this.keys = keys;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].toSorted();
    throw new ConfigError(keys);
  }
  return { databaseUrl: result.data.DATABASE_URL, port: result.data.PORT };
}

export function loadConfigOrExit(env: NodeJS.ProcessEnv): Config {
  try {
    return loadConfig(env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
