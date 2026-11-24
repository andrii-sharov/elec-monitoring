import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';
import { desc, eq } from 'drizzle-orm';
import type { Clock } from '../src/clock.ts';
import { systemClock } from '../src/clock.ts';
import { loadFirmwareReleaseConfigOrExit } from '../src/config.ts';
import { createDb, type Db } from '../src/db/client.ts';
import { firmwareRelease } from '../src/db/schema/index.ts';
import { versionCode } from '../src/firmware/releases.ts';
import { createFirmwareStore, type FirmwareStore } from '../src/firmware/store.ts';
import { verifyRelease, type ReleaseFiles } from '../src/firmware/verify.ts';

export type ReleaseEnv = 'staging' | 'production';
export type ReleaseOutcome = 'CREATED' | 'PUBLISHED' | 'UNCHANGED';
export type ReleaseArgs = { dir: string; version: string; env: ReleaseEnv; publish: boolean };

const USAGE =
  'usage: firmware:release <dir> --version <MAJOR.MINOR.PATCH> --env staging|production [--publish]';

export async function releaseFirmware(
  deps: { db: Db; store: FirmwareStore; clock: Clock },
  a: { version: string; files: ReleaseFiles; publicKeyPem: string; publish: boolean },
): Promise<ReleaseOutcome> {
  const code = versionCode(a.version);
  const { sha256 } = verifyRelease(a.files, a.publicKeyPem);

  const [existing] = await deps.db
    .select()
    .from(firmwareRelease)
    .where(eq(firmwareRelease.version, a.version));
  if (existing) {
    if (!existing.sha256.equals(sha256)) {
      throw new Error(`Version ${a.version} already exists with a different image`);
    }
    if (!a.publish || existing.publishedAt) return 'UNCHANGED';
    await deps.db
      .update(firmwareRelease)
      .set({ publishedAt: deps.clock.now() })
      .where(eq(firmwareRelease.id, existing.id));
    return 'PUBLISHED';
  }

  const [highest] = await deps.db
    .select({ version: firmwareRelease.version, versionCode: firmwareRelease.versionCode })
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.versionCode))
    .limit(1);
  if (highest && code <= highest.versionCode) {
    throw new Error(`Version ${a.version} must be above ${highest.version}`);
  }

  await deps.store.put(`${a.version}/app.bin`, a.files.app);
  await deps.store.put(`${a.version}/factory.bin`, a.files.factory);
  await deps.db.insert(firmwareRelease).values({
    version: a.version,
    versionCode: code,
    sizeBytes: a.files.app.length,
    sha256,
    signature: Buffer.from(a.files.signature),
    imagePath: a.version,
    publishedAt: a.publish ? deps.clock.now() : null,
  });
  return a.publish ? 'PUBLISHED' : 'CREATED';
}

export function parseArgs(argv: string[]): ReleaseArgs {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: 'string' },
      env: { type: 'string' },
      publish: { type: 'boolean', default: false },
    },
  });
  const [dir] = positionals;
  const env = values.env;
  if (!dir || positionals.length !== 1 || !values.version) throw new Error(USAGE);
  if (env !== 'staging' && env !== 'production') throw new Error(USAGE);
  return { dir, version: values.version, env, publish: values.publish };
}

export function assetNames(
  version: string,
  env: ReleaseEnv,
): { app: string; factory: string; signature: string } {
  const prefix = `elec-fw-${version}-${env}`;
  return {
    app: `${prefix}-app.bin`,
    factory: `${prefix}-factory.bin`,
    signature: `${prefix}-app.sig`,
  };
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const names = assetNames(args.version, args.env);
  const files: ReleaseFiles = {
    app: await readFile(join(args.dir, names.app)),
    factory: await readFile(join(args.dir, names.factory)),
    signature: await readFile(join(args.dir, names.signature)),
  };
  const publicKeyPem = await readFile(
    new URL('../../firmware/keys/ota-signing.pub.pem', import.meta.url),
    'utf8',
  );

  const config = loadFirmwareReleaseConfigOrExit(process.env);
  const { db, close } = createDb(config.databaseUrl);
  try {
    const outcome = await releaseFirmware(
      { db, store: createFirmwareStore(config.firmware), clock: systemClock },
      { version: args.version, files, publicKeyPem, publish: args.publish },
    );
    console.info(`${args.version} (${args.env}): ${outcome}`);
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
