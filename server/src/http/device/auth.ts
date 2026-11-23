import { eq } from 'drizzle-orm';
import type { RequestHandler, Response } from 'express';
import { device } from '../../db/schema/index.ts';
import { hashDeviceToken, isDeviceTokenFormat } from '../../devices/credentials.ts';
import type { AppDeps } from '../app.ts';
import { HttpError } from '../errors.ts';

export type DeviceAuth = { deviceId: string; tokenHash: Buffer };

const BEARER = /^Bearer (\S+)$/;

export function requireDevice(deps: Pick<AppDeps, 'db'>): RequestHandler {
  return async (req, res, next) => {
    const token = BEARER.exec(req.get('Authorization') ?? '')?.[1];
    if (!token || !isDeviceTokenFormat(token))
      throw new HttpError(401, 'unauthorized', 'Unauthorized');
    const tokenHash = hashDeviceToken(token);
    const [row] = await deps.db
      .select({ id: device.id })
      .from(device)
      .where(eq(device.tokenHash, tokenHash));
    if (!row) throw new HttpError(401, 'unauthorized', 'Unauthorized');
    const auth: DeviceAuth = { deviceId: row.id, tokenHash };
    res.locals.device = auth;
    next();
  };
}

export function getDeviceAuth(res: Response): DeviceAuth {
  const auth = res.locals.device as DeviceAuth | undefined;
  if (!auth) throw new Error('requireDevice must run before getDeviceAuth');
  return auth;
}
