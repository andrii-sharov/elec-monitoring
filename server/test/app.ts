import type { Express } from 'express';
import type { Db } from '../src/db/client.ts';
import { createApp } from '../src/http/app.ts';
import type { Logger } from '../src/logger.ts';
import { FakeClock, silentLogger } from './fakes.ts';

export function testApp(
  overrides: { db?: Db; logger?: Logger; routes?: (app: Express) => void } = {},
): Express {
  return createApp(
    {
      db: overrides.db ?? ({} as Db),
      clock: new FakeClock(new Date('2026-11-21T16:42:00Z')),
      logger: overrides.logger ?? silentLogger(),
      config: { databaseUrl: 'postgres://localhost/test', port: 0 },
    },
    overrides.routes,
  );
}
