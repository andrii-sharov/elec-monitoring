import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { device } from '../../db/schema/index.ts';
import {
  hashDeviceToken,
  hashPairingCode,
  newDeviceToken,
  normalizePairingCode,
} from '../../devices/credentials.ts';
import { AUTH_PER_IP } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';

export const fwSchema = z.string().min(1).max(32).meta({ example: '2.0.0' });

const claimBodySchema = z.object({
  pairing_code: z
    .string()
    .max(32)
    .transform(normalizePairingCode)
    .pipe(z.string().regex(/^[0-9A-Z]{8}$/))
    .meta({ example: 'K7Q2M9XD' }),
  fw: fwSchema,
});

const claimResponseSchema = z.object({
  device_id: z.string(),
  device_token: z.string().meta({ description: '64 hex chars, shown once' }),
  settings: z.object({ version: z.number().int(), ping_interval_s: z.number().int() }),
});

export const claimPaths: ZodOpenApiPathsObject = {
  '/api/v1/device/claim': {
    post: {
      summary: 'Exchange a pairing code for the device token',
      description:
        'Single use, valid 30 minutes. Case, spaces and hyphens in the code are ignored. Claiming replaces any previous device token.',
      requestBody: { content: { 'application/json': { schema: claimBodySchema } } },
      responses: {
        '200': {
          description: 'Device token and settings',
          content: { 'application/json': { schema: claimResponseSchema } },
        },
        '400': errorResponse('Invalid body'),
        '404': errorResponse('Unknown, used or replaced pairing code'),
        '410': errorResponse('Pairing code expired'),
        '429': errorResponse('Too many requests, with `Retry-After`'),
      },
    },
  },
};

export function claimRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, rateLimiter } = deps;

  router.post(
    '/api/v1/device/claim',
    rateLimit(rateLimiter, 'claim', { ip: AUTH_PER_IP }),
    async (req, res) => {
      const body = claimBodySchema.parse(req.body ?? {});
      const now = clock.now();
      const token = newDeviceToken();
      const claimed = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(device)
          .where(eq(device.pairingCodeHash, hashPairingCode(body.pairing_code)))
          .for('update');
        if (!row) throw new HttpError(404, 'not_found', 'Pairing code not found');
        if (row.pairingCodeExpiresAt && row.pairingCodeExpiresAt.getTime() <= now.getTime()) {
          throw new HttpError(410, 'expired', 'Pairing code expired');
        }
        await tx
          .update(device)
          .set({
            tokenHash: hashDeviceToken(token),
            claimedAt: now,
            fwVersion: body.fw,
            pairingCodeHash: null,
            pairingCodeExpiresAt: null,
            bootId: null,
            seq: null,
            appliedSettingsVersion: row.settingsVersion,
            previousPingIntervalS: null,
          })
          .where(eq(device.id, row.id));
        return row;
      });
      res.json({
        device_id: claimed.id,
        device_token: token,
        settings: { version: claimed.settingsVersion, ping_interval_s: claimed.pingIntervalS },
      });
    },
  );

  return router;
}
