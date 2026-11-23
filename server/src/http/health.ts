import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import type { Db } from '../db/client.ts';

const PING_TIMEOUT_MS = 3000;

export const healthPaths: ZodOpenApiPathsObject = {
  '/health': {
    get: {
      summary: 'Health server check',
      description: 'Reports whether the API can reach its database.',
      responses: {
        '200': {
          description: 'The database is reachable',
          content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
        },
        '503': {
          description: 'The database is unreachable or did not answer in 3 s',
          content: {
            'application/json': { schema: z.object({ status: z.literal('unavailable') }) },
          },
        },
      },
    },
  },
};

async function ping(db: Db): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
  });
  try {
    return await Promise.race([db.execute(sql`select 1`).then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function healthRouter(db: Db): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    if (await ping(db)) res.json({ status: 'ok' });
    else res.status(503).json({ status: 'unavailable' });
  });
  return router;
}
