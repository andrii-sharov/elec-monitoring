import { diagnosticKinds } from '@elec/shared';
import {
  checkRange,
  outagesPageSchema,
  outagesQuerySchema,
  page,
  rangeQueryFields,
  deviceParamsSchema,
} from '@elec/shared/api';
import { and, desc, eq, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { deviceBoot, deviceDiagnostic, outage } from '../../db/schema/index.ts';
import { getAccessibleDevice } from '../../devices/access.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser } from '../auth/middleware.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { decodeCursor, encodeCursor } from '../pagination.ts';
import { bearer, deviceIdParam, deviceNotFound, ownerOnly, unauthorized } from './devices.ts';
import { toOutageItem } from './views.ts';

type Range = { from?: string; to?: string };

const diagnosticsQuerySchema = z
  .object({ ...rangeQueryFields, kind: z.enum(diagnosticKinds).optional() })
  .superRefine(checkRange);

const diagnosticItemSchema = z
  .object({
    boot_id: z.string(),
    id: z.number().int(),
    kind: z.enum(diagnosticKinds),
    reason: z.number().int().nullable(),
    started_at: z.string(),
    ended_at: z.string(),
    duration_s: z.number().int(),
    boot_wifi_evicted: z.number().int(),
  })
  .meta({ id: 'DiagnosticItem' });

const cursorDate = z.iso.datetime({ offset: true });

function parseCursor<T extends z.ZodTuple>(cursor: string, shape: T): z.infer<T> {
  const parsed = shape.safeParse(decodeCursor(cursor, shape.def.items.length));
  if (!parsed.success)
    throw new HttpError(400, 'validation_error', 'Invalid cursor', [
      { path: 'cursor', code: 'invalid_cursor' },
    ]);
  return parsed.data;
}

function outageRange(q: Range): SQL[] {
  const conditions: SQL[] = [];
  if (q.to) conditions.push(lt(outage.startedAt, new Date(q.to)));
  if (q.from) conditions.push(or(isNull(outage.endedAt), gt(outage.endedAt, new Date(q.from)))!);
  return conditions;
}

function diagnosticRange(q: Range): SQL[] {
  const conditions: SQL[] = [];
  if (q.to) conditions.push(lt(deviceDiagnostic.startedAt, new Date(q.to)));
  if (q.from) conditions.push(gt(deviceDiagnostic.endedAt, new Date(q.from)));
  return conditions;
}

export const historyPaths: ZodOpenApiPathsObject = {
  '/api/v1/devices/{id}/outages': {
    get: {
      summary: 'List outages and power blips',
      description:
        'Newest first. `from` and `to` keep outages that overlap the range (`from` inclusive, `to` exclusive). An open outage has `ended_at`, `cause` and `kind` set to `null`.',
      security: bearer,
      requestParams: { path: deviceParamsSchema, query: outagesQuerySchema },
      responses: {
        '200': {
          description: 'A page of outages',
          content: { 'application/json': { schema: outagesPageSchema } },
        },
        '400': errorResponse('Invalid query or cursor'),
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
  },
  '/api/v1/devices/{id}/diagnostics': {
    get: {
      summary: 'List Wi-Fi and API reachability diagnostics',
      description: 'Owner only. Newest first. Times are estimated from the device uptime.',
      security: bearer,
      requestParams: { path: deviceParamsSchema, query: diagnosticsQuerySchema },
      responses: {
        '200': {
          description: 'A page of diagnostics',
          content: { 'application/json': { schema: page(diagnosticItemSchema) } },
        },
        '400': errorResponse('Invalid query or cursor'),
        '401': unauthorized,
        '403': ownerOnly,
        '404': deviceNotFound,
      },
    },
  },
};

export function historyRouter(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const auth = requireUser(deps);

  router.get('/api/v1/devices/:id/outages', auth, async (req, res) => {
    const id = deviceIdParam(req);
    const q = outagesQuerySchema.parse(req.query);
    await getAccessibleDevice(db, getAuth(res).user.id, id, 'read');
    const conditions = [eq(outage.deviceId, id), ...outageRange(q)];
    if (q.type) conditions.push(eq(outage.type, q.type));
    if (q.cause) conditions.push(eq(outage.cause, q.cause));
    if (q.kind) conditions.push(eq(outage.kind, q.kind));
    if (q.cursor) {
      const [startedAt, outageId] = parseCursor(q.cursor, z.tuple([cursorDate, z.uuid()]));
      conditions.push(
        sql`(${outage.startedAt}, ${outage.id}) < (${new Date(startedAt)}, ${outageId})`,
      );
    }
    const rows = await db
      .select()
      .from(outage)
      .where(and(...conditions))
      .orderBy(desc(outage.startedAt), desc(outage.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    res.json({
      items: items.map(toOutageItem),
      next_cursor:
        rows.length > q.limit && last
          ? encodeCursor([last.startedAt.toISOString(), last.id])
          : null,
    });
  });

  router.get('/api/v1/devices/:id/diagnostics', auth, async (req, res) => {
    const id = deviceIdParam(req);
    const q = diagnosticsQuerySchema.parse(req.query);
    await getAccessibleDevice(db, getAuth(res).user.id, id, 'manage');
    const d = deviceDiagnostic;
    const conditions = [eq(d.deviceId, id), ...diagnosticRange(q)];
    if (q.kind) conditions.push(eq(d.kind, q.kind));
    if (q.cursor) {
      const [startedAt, bootId, localId] = parseCursor(
        q.cursor,
        z.tuple([
          cursorDate,
          z.uuid(),
          z
            .string()
            .regex(/^\d{1,10}$/)
            .transform(Number)
            .pipe(z.number().max(2_147_483_647)),
        ]),
      );
      conditions.push(
        sql`(${d.startedAt}, ${d.bootId}, ${d.localId}) < (${new Date(startedAt)}, ${bootId}, ${localId})`,
      );
    }
    const rows = await db
      .select({ diagnostic: d, evicted: deviceBoot.wifiEvicted })
      .from(d)
      .innerJoin(
        deviceBoot,
        and(eq(deviceBoot.deviceId, d.deviceId), eq(deviceBoot.bootId, d.bootId)),
      )
      .where(and(...conditions))
      .orderBy(desc(d.startedAt), desc(d.bootId), desc(d.localId))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit);
    const last = items.at(-1)?.diagnostic;
    res.json({
      items: items.map(({ diagnostic, evicted }) => ({
        boot_id: diagnostic.bootId,
        id: diagnostic.localId,
        kind: diagnostic.kind,
        reason: diagnostic.reason,
        started_at: diagnostic.startedAt.toISOString(),
        ended_at: diagnostic.endedAt.toISOString(),
        duration_s: diagnostic.endUptimeS - diagnostic.startUptimeS,
        boot_wifi_evicted: evicted,
      })),
      next_cursor:
        rows.length > q.limit && last
          ? encodeCursor([last.startedAt.toISOString(), last.bootId, String(last.localId)])
          : null,
    });
  });

  return router;
}
