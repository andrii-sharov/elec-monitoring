import { checkInTypes, diagnosticKinds, resetReasons } from '@elec/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { recordCheckIn } from '../../monitoring/checkIn.ts';
import { DEVICE_CHECKIN } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { getDeviceAuth, requireDevice } from './auth.ts';
import { fwSchema } from './claim.ts';

const INT32_MAX = 2_147_483_647;
const counter = z.number().int().min(0).max(INT32_MAX);

const wifiEventSchema = z.object({
  id: counter,
  kind: z.enum(diagnosticKinds),
  start_uptime_s: counter,
  end_uptime_s: counter,
  reason: z.number().int().min(0).max(32_767).nullable().optional(),
});

export const pingBodySchema = z.object({
  type: z.enum(checkInTypes),
  boot_id: z.uuid(),
  seq: counter,
  uptime_s: counter,
  reset_reason: z.enum(resetReasons).catch('UNKNOWN'),
  rssi: z.number().int().min(-128).max(127),
  fw: fwSchema,
  settings_version: z.number().int().min(0).optional(),
  wifi: z.object({ evicted: counter, events: z.array(wifiEventSchema).max(32) }).optional(),
});

export const pingPaths: ZodOpenApiPathsObject = {
  '/api/v1/device/ping': {
    post: {
      summary: 'Device check-in',
      description:
        '`BOOT` or `PING`. Duplicates (same `boot_id`, `seq` not above the last) are acknowledged without changes. The `204` acknowledges the Wi-Fi events in the request.',
      security: [{ deviceToken: [] }],
      requestBody: { content: { 'application/json': { schema: pingBodySchema } } },
      responses: {
        '204': { description: 'Accepted, or a duplicate acknowledged' },
        '400': errorResponse('Invalid body'),
        '401': errorResponse('Unknown or rotated device token'),
        '429': errorResponse('More than 6 check-ins a minute, with `Retry-After`'),
      },
    },
  },
};

export function pingRouter(deps: AppDeps): Router {
  const router = Router();

  router.post(
    '/api/v1/device/ping',
    requireDevice(deps),
    rateLimit(deps.rateLimiter, 'checkin', { device: DEVICE_CHECKIN }),
    async (req, res) => {
      const body = pingBodySchema.parse(req.body ?? {});
      const { deviceId, tokenHash } = getDeviceAuth(res);
      const result = await recordCheckIn(deps, deviceId, tokenHash, {
        type: body.type,
        bootId: body.boot_id,
        seq: body.seq,
        uptimeS: body.uptime_s,
        resetReason: body.reset_reason,
        rssi: body.rssi,
        fw: body.fw,
        wifi: body.wifi,
      });
      if (result === 'UNAUTHORIZED') throw new HttpError(401, 'unauthorized', 'Unauthorized');
      res.status(204).end();
    },
  );

  return router;
}
