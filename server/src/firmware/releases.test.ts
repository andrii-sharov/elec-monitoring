import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { firmwareRelease } from '../db/schema/index.ts';
import { findPublished, latestPublished, versionCode } from './releases.ts';

describe('versionCode', () => {
  test('packs major, minor and patch', () => {
    expect(versionCode('2.1.3')).toBe(2_001_003);
    expect(versionCode('0.0.1')).toBe(1);
    expect(versionCode('999.999.999')).toBe(999_999_999);
  });

  test.each(['2.1', '0.0.0-dev', '1.1000.0', 'v2.0.0', '2.0.0.1', '', '1.0.x'])(
    'rejects %j',
    (version) => {
      expect(() => versionCode(version)).toThrow(/MAJOR.MINOR.PATCH/);
    },
  );
});

describe('published releases', () => {
  let t: TestDb;
  const published = new Date('2026-11-01T00:00:00Z');

  beforeAll(async () => {
    t = await createTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await t.db.delete(firmwareRelease);
  });

  async function release(
    version: string,
    opts: { channel?: 'STABLE' | 'BETA'; publishedAt?: Date | null } = {},
  ) {
    await t.db.insert(firmwareRelease).values({
      version,
      versionCode: versionCode(version),
      channel: opts.channel ?? 'STABLE',
      sizeBytes: 100,
      sha256: Buffer.alloc(32),
      signature: Buffer.from([1]),
      imagePath: version,
      publishedAt: opts.publishedAt === undefined ? published : opts.publishedAt,
    });
  }

  test('latest is null without releases', async () => {
    expect(await latestPublished(t.db)).toBeNull();
  });

  test('latest ignores drafts and BETA and orders by version code', async () => {
    await release('2.9.0');
    await release('2.10.0');
    await release('2.11.0', { publishedAt: null });
    await release('3.0.0', { channel: 'BETA' });
    expect((await latestPublished(t.db))?.version).toBe('2.10.0');
  });

  test('findPublished returns only published releases', async () => {
    await release('2.0.0');
    await release('2.1.0', { publishedAt: null });
    expect((await findPublished(t.db, '2.0.0'))?.imagePath).toBe('2.0.0');
    expect(await findPublished(t.db, '2.1.0')).toBeNull();
    expect(await findPublished(t.db, '9.9.9')).toBeNull();
  });
});
