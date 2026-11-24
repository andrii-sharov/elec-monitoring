import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { firmwareRelease } from '../db/schema/index.ts';

export type FirmwareReleaseRow = typeof firmwareRelease.$inferSelect;

const PLAIN_SEMVER = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

export function versionCode(version: string): number {
  const match = PLAIN_SEMVER.exec(version);
  if (!match) throw new Error(`Not a plain MAJOR.MINOR.PATCH version: ${JSON.stringify(version)}`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  return major * 1_000_000 + minor * 1_000 + patch;
}

export async function latestPublished(db: Executor): Promise<FirmwareReleaseRow | null> {
  const [row] = await db
    .select()
    .from(firmwareRelease)
    .where(and(eq(firmwareRelease.channel, 'STABLE'), isNotNull(firmwareRelease.publishedAt)))
    .orderBy(desc(firmwareRelease.versionCode))
    .limit(1);
  return row ?? null;
}

export async function findPublished(
  db: Executor,
  version: string,
): Promise<FirmwareReleaseRow | null> {
  const [row] = await db
    .select()
    .from(firmwareRelease)
    .where(and(eq(firmwareRelease.version, version), isNotNull(firmwareRelease.publishedAt)))
    .limit(1);
  return row ?? null;
}
