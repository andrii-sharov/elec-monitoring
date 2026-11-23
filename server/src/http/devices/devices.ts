import {
  createDeviceBodySchema,
  createDeviceResponseSchema,
  deviceListSchema,
  deviceParamsSchema,
  devicePatchSchema,
  deviceSchema,
  pairingCodeSchema,
} from '@elec/shared/api';
import { count, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { appUser, device } from '../../db/schema/index.ts';
import { getAccessibleDevice } from '../../devices/access.ts';
import { PAIRING_CODE_TTL_MS, hashPairingCode, newPairingCode } from '../../devices/credentials.ts';
import { findDeviceView, findDeviceViews } from '../../devices/queries.ts';
import { applySettingsPatch } from '../../devices/settings.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser, requireVerifiedEmail } from '../auth/middleware.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { toDevice, toDeviceListItem } from './views.ts';

export const MAX_DEVICES_PER_USER = 20;

export function deviceIdParam(req: Request): string {
  return deviceParamsSchema.parse(req.params).id;
}

export const bearer = [{ bearerAuth: [] }];
export const unauthorized = errorResponse('Missing or invalid access token');
export const deviceNotFound = errorResponse('Device not found or not accessible');
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });

export function newPairingCodeFields(now: Date) {
  const code = newPairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  return {
    code,
    expiresAt,
    columns: { pairingCodeHash: hashPairingCode(code), pairingCodeExpiresAt: expiresAt },
  };
}

export const devicesPaths: ZodOpenApiPathsObject = {
  '/api/v1/devices': {
    get: {
      summary: 'List devices',
      security: bearer,
      responses: {
        '200': {
          description: 'Own devices, oldest first',
          content: json(deviceListSchema),
        },
        '401': unauthorized,
      },
    },
    post: {
      summary: 'Create a device',
      description: 'Returns a pairing code valid for 30 minutes. At most 20 devices per owner.',
      security: bearer,
      requestBody: { content: json(createDeviceBodySchema) },
      responses: {
        '201': {
          description: 'Device and pairing code',
          content: json(createDeviceResponseSchema),
        },
        '400': errorResponse('Invalid body'),
        '401': unauthorized,
        '403': errorResponse('`email_not_verified`'),
        '409': errorResponse('Device limit reached'),
      },
    },
  },
  '/api/v1/devices/{id}': {
    get: {
      summary: 'Get a device',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      responses: {
        '200': { description: 'The device', content: json(deviceSchema) },
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
    patch: {
      summary: 'Update name and settings',
      description:
        'Changing `ping_interval_s` increments the desired settings version. `offline_timeout_s` must be at least twice `ping_interval_s`.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      requestBody: { content: json(devicePatchSchema) },
      responses: {
        '200': { description: 'The updated device', content: json(deviceSchema) },
        '400': errorResponse('Invalid body'),
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
    delete: {
      summary: 'Delete a device',
      description: 'Removes its outages, diagnostics, memberships and queued notifications.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      responses: { '204': { description: 'Deleted' }, '401': unauthorized, '404': deviceNotFound },
    },
  },
  '/api/v1/devices/{id}/pairing-code': {
    post: {
      summary: 'Issue a new pairing code',
      description:
        'Replaces any earlier code. The current device token keeps working until the new code is claimed.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      responses: {
        '201': { description: 'The new pairing code', content: json(pairingCodeSchema) },
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
  },
  '/api/v1/devices/{id}/rotate-token': {
    post: {
      summary: 'Invalidate the device token',
      description: 'The device gets `401` and needs re-pairing with a new code.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      responses: {
        '204': { description: 'Token invalidated' },
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
  },
};

export function devicesRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock } = deps;
  const auth = requireUser(deps);

  router.post('/api/v1/devices', auth, requireVerifiedEmail, async (req, res) => {
    const { user } = getAuth(res);
    const { name } = createDeviceBodySchema.parse(req.body ?? {});
    const now = clock.now();
    const pairing = newPairingCodeFields(now);
    const id = await db.transaction(async (tx) => {
      await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(eq(appUser.id, user.id))
        .for('update');
      const [owned] = await tx
        .select({ n: count() })
        .from(device)
        .where(eq(device.ownerId, user.id));
      if ((owned?.n ?? 0) >= MAX_DEVICES_PER_USER) {
        throw new HttpError(409, 'conflict', 'Device limit reached');
      }
      const [row] = await tx
        .insert(device)
        .values({ ownerId: user.id, name, stateSince: now, ...pairing.columns })
        .returning({ id: device.id });
      return row!.id;
    });
    const view = await findDeviceView(db, id, 'OWNER');
    res.status(201).json({
      device: toDevice(view!),
      pairing_code: pairing.code,
      pairing_code_expires_at: pairing.expiresAt.toISOString(),
    });
  });

  router.get('/api/v1/devices', auth, async (_req, res) => {
    const views = await findDeviceViews(db, getAuth(res).user.id);
    res.json({ items: views.map(toDeviceListItem) });
  });

  router.get('/api/v1/devices/:id', auth, async (req, res) => {
    const { role } = await getAccessibleDevice(
      db,
      getAuth(res).user.id,
      deviceIdParam(req),
      'read',
    );
    const view = await findDeviceView(db, deviceIdParam(req), role);
    if (!view) throw new HttpError(404, 'not_found', 'Device not found');
    res.json(toDevice(view));
  });

  router.patch('/api/v1/devices/:id', auth, async (req, res) => {
    const id = deviceIdParam(req);
    const body = devicePatchSchema.parse(req.body ?? {});
    const role = await db.transaction(async (tx) => {
      const access = await getAccessibleDevice(tx, getAuth(res).user.id, id, 'manage', {
        lock: true,
      });
      const result = applySettingsPatch(access.device, body.settings ?? {});
      if ('error' in result) {
        throw new HttpError(400, 'validation_error', 'Invalid request', [result.error]);
      }
      const changes = { ...result.changes, ...(body.name ? { name: body.name } : {}) };
      if (Object.keys(changes).length > 0) {
        await tx.update(device).set(changes).where(eq(device.id, id));
      }
      return access.role;
    });
    res.json(toDevice((await findDeviceView(db, id, role))!));
  });

  router.post('/api/v1/devices/:id/pairing-code', auth, async (req, res) => {
    const id = deviceIdParam(req);
    await getAccessibleDevice(db, getAuth(res).user.id, id, 'manage');
    const pairing = newPairingCodeFields(clock.now());
    await db.update(device).set(pairing.columns).where(eq(device.id, id));
    res.status(201).json({
      pairing_code: pairing.code,
      pairing_code_expires_at: pairing.expiresAt.toISOString(),
    });
  });

  router.post('/api/v1/devices/:id/rotate-token', auth, async (req, res) => {
    const id = deviceIdParam(req);
    await getAccessibleDevice(db, getAuth(res).user.id, id, 'manage');
    await db.update(device).set({ tokenHash: null }).where(eq(device.id, id));
    res.status(204).end();
  });

  router.delete('/api/v1/devices/:id', auth, async (req, res) => {
    const id = deviceIdParam(req);
    await getAccessibleDevice(db, getAuth(res).user.id, id, 'manage');
    await db.delete(device).where(eq(device.id, id));
    res.status(204).end();
  });

  return router;
}
