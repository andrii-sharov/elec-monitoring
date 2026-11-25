import type { Db } from '../src/db/client.ts';
import { deviceViewer } from '../src/db/schema/index.ts';

export async function addViewer(db: Db, deviceId: string, userId: string): Promise<void> {
  await db.insert(deviceViewer).values({ deviceId, userId });
}
