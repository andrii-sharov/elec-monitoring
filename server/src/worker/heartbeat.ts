import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { workerHeartbeat } from '../db/schema/index.ts';

export async function beat(db: Db, clock: Clock, worker: string, instanceId: string) {
  const beatAt = clock.now();
  await db
    .insert(workerHeartbeat)
    .values({ worker, instanceId, beatAt })
    .onConflictDoUpdate({ target: workerHeartbeat.worker, set: { instanceId, beatAt } });
}
