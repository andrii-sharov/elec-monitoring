import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../test/db.ts';
import { FakeClock } from '../test/fakes.ts';
import { signedRelease, testKeyPair } from '../test/firmware.ts';
import { firmwareRelease } from '../src/db/schema/index.ts';
import { memoryStore, type FirmwareStore } from '../src/firmware/store.ts';
import { assetNames, parseArgs, releaseFirmware } from './firmware-release.ts';

const keys = testKeyPair();
const T = new Date('2026-11-24T12:00:00Z');

let t: TestDb;
let clock: FakeClock;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(firmwareRelease);
  clock = new FakeClock(T);
});

function run(
  store: FirmwareStore,
  version: string,
  publish: boolean,
  files = signedRelease(keys.privateKeyPem),
) {
  return releaseFirmware(
    { db: t.db, store, clock },
    { version, files, publicKeyPem: keys.publicKeyPem, publish },
  );
}

async function row(version: string) {
  const [found] = await t.db
    .select()
    .from(firmwareRelease)
    .where(eq(firmwareRelease.version, version));
  return found;
}

describe('releaseFirmware', () => {
  test('creates a draft and uploads both images', async () => {
    const store = memoryStore();
    const files = signedRelease(keys.privateKeyPem);
    expect(await run(store, '2.0.0', false, files)).toBe('CREATED');
    expect(store.files.get('2.0.0/app.bin')).toEqual(files.app);
    expect(store.files.get('2.0.0/factory.bin')).toEqual(files.factory);
    expect(await row('2.0.0')).toMatchObject({
      versionCode: 2_000_000,
      sizeBytes: files.app.length,
      signature: Buffer.from(files.signature),
      imagePath: '2.0.0',
      channel: 'STABLE',
      publishedAt: null,
    });
    expect((await row('2.0.0'))!.sha256).toHaveLength(32);
  });

  test('publishes an existing draft, then reports no change', async () => {
    const store = memoryStore();
    const files = signedRelease(keys.privateKeyPem);
    await run(store, '2.0.0', false, files);
    clock.set(new Date('2026-11-24T13:00:00Z'));
    expect(await run(store, '2.0.0', true, files)).toBe('PUBLISHED');
    expect((await row('2.0.0'))!.publishedAt).toEqual(new Date('2026-11-24T13:00:00Z'));
    expect(await run(store, '2.0.0', true, files)).toBe('UNCHANGED');
    expect(await run(store, '2.0.0', false, files)).toBe('UNCHANGED');
  });

  test('a new version with publish is published at once', async () => {
    expect(await run(memoryStore(), '2.0.0', true)).toBe('PUBLISHED');
    expect((await row('2.0.0'))!.publishedAt).toEqual(T);
  });

  test('refuses the same version with a different image and uploads nothing', async () => {
    await run(memoryStore(), '2.0.0', false);
    const store = memoryStore();
    await expect(run(store, '2.0.0', true)).rejects.toThrow(/different image/);
    expect(store.files.size).toBe(0);
  });

  test('refuses a version not above the highest release', async () => {
    await run(memoryStore(), '2.1.0', false);
    const store = memoryStore();
    await expect(run(store, '2.0.9', false)).rejects.toThrow(/above 2\.1\.0/);
    expect(store.files.size).toBe(0);
  });

  test('refuses a dev version', async () => {
    await expect(run(memoryStore(), '0.0.0-dev', false)).rejects.toThrow(/MAJOR.MINOR.PATCH/);
  });

  test('refuses a release that does not verify', async () => {
    const files = signedRelease(testKeyPair().privateKeyPem);
    const store = memoryStore();
    await expect(run(store, '2.0.0', false, files)).rejects.toThrow(/signature/i);
    expect(store.files.size).toBe(0);
    expect(await row('2.0.0')).toBeUndefined();
  });

  test('a failed upload leaves no row', async () => {
    const failing: FirmwareStore = {
      get: async () => null,
      put: async () => {
        throw new Error('upload failed');
      },
    };
    await expect(run(failing, '2.0.0', false)).rejects.toThrow(/upload failed/);
    expect(await row('2.0.0')).toBeUndefined();
  });
});

describe('cli', () => {
  test('parses arguments', () => {
    expect(parseArgs(['/tmp/fw', '--version', '2.0.0', '--env', 'staging', '--publish'])).toEqual({
      dir: '/tmp/fw',
      version: '2.0.0',
      env: 'staging',
      publish: true,
    });
    expect(parseArgs(['/tmp/fw', '--version', '2.0.0', '--env', 'production']).publish).toBe(false);
  });

  test.each([
    [['--version', '2.0.0', '--env', 'staging']],
    [['/tmp/fw', '--env', 'staging']],
    [['/tmp/fw', '--version', '2.0.0', '--env', 'dev']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow(/usage/);
  });

  test('names the release assets', () => {
    expect(assetNames('2.0.0', 'staging')).toEqual({
      app: 'elec-fw-2.0.0-staging-app.bin',
      factory: 'elec-fw-2.0.0-staging-factory.bin',
      signature: 'elec-fw-2.0.0-staging-app.sig',
    });
  });
});
