import { deviceParamsSchema, statsQuerySchema, statsSchema } from '@elec/shared/api';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { getAccessibleDevice } from '../../devices/access.ts';
import { loadStats } from '../../stats/load.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser } from '../auth/middleware.ts';
import { errorResponse } from '../errors.ts';
import { bearer, deviceIdParam, deviceNotFound, unauthorized } from './devices.ts';

export const statsPaths: ZodOpenApiPathsObject = {
  '/api/v1/devices/{id}/stats': {
    get: {
      summary: 'Statistics for a History range',
      description:
        'Outages, downtime and availability for a local day, week, month, year or custom range (up to 366 days) in the caller timezone. `from` and `to` are local dates. Outages and power blips count in every bucket they overlap.',
      security: bearer,
      requestParams: { path: deviceParamsSchema, query: statsQuerySchema },
      responses: {
        '200': {
          description: 'Statistics',
          content: { 'application/json': { schema: statsSchema } },
        },
        '400': errorResponse('Invalid range'),
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
  },
};

export function statsRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock } = deps;

  router.get('/api/v1/devices/:id/stats', requireUser(deps), async (req, res) => {
    const id = deviceIdParam(req);
    const query = statsQuerySchema.parse(req.query);
    const { user } = getAuth(res);
    const { device } = await getAccessibleDevice(db, user.id, id, 'read');
    res.json(
      await loadStats(db, {
        device,
        query,
        timezone: user.timezone,
        now: clock.now().getTime(),
      }),
    );
  });

  return router;
}
