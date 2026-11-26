import type { DeliveryEvent, DeliveryStatus } from '@elec/shared';
import {
  deliveriesQuerySchema,
  deliveryItemSchema,
  deliveryListSchema,
  deliveryParamsSchema,
  type DeliveryItem,
} from '@elec/shared/api';
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { delivery, notificationChannel, outage } from '../../db/schema/index.ts';
import { REDELIVER_PER_USER } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser, requireVerified } from '../auth/middleware.ts';
import { bearer, unauthorized } from '../devices/devices.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { cursorDateSchema, encodeCursor, parseCursor } from '../pagination.ts';
import { rateLimit } from '../rateLimit.ts';
import { channelParamsSchema, myChannel } from './channels.ts';

const cursorShape = z.tuple([cursorDateSchema, z.uuid()]);

const json = (schema: z.ZodType) => ({ 'application/json': { schema } });

export const deliveriesPaths: ZodOpenApiPathsObject = {
  '/api/v1/channels/{id}/deliveries': {
    get: {
      summary: 'Delivery log of one of my channels',
      description: 'Newest first. `limit` defaults to 20, max 100.',
      security: bearer,
      requestParams: { path: channelParamsSchema, query: deliveriesQuerySchema },
      responses: {
        '200': { description: 'A page of deliveries', content: json(deliveryListSchema) },
        '400': errorResponse('Invalid channel ID, query or cursor'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
      },
    },
  },
  '/api/v1/deliveries/{id}/redeliver': {
    post: {
      summary: 'Send a webhook delivery again',
      description:
        'Queues a `SENT` or `FAILED` delivery again with the same delivery ID and a fresh retry schedule. Limited to 30 per minute.',
      security: bearer,
      requestParams: { path: deliveryParamsSchema },
      responses: {
        '202': { description: 'The queued delivery', content: json(deliveryItemSchema) },
        '400': errorResponse('Invalid delivery ID'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Delivery not found or not yours'),
        '409': errorResponse('Not a webhook, channel off, or delivery still in progress'),
        '429': errorResponse('Too many requests'),
      },
    },
  },
};

function toDeliveryItem(row: typeof delivery.$inferSelect, deviceId: string): DeliveryItem {
  return {
    id: row.id,
    event: row.event as DeliveryEvent,
    device_id: deviceId,
    status: row.status as DeliveryStatus,
    attempts: row.attempts,
    last_attempt_at: row.lastAttemptAt?.toISOString() ?? null,
    last_error: row.lastError,
    created_at: row.createdAt.toISOString(),
  };
}

const conflict = (message: string) => new HttpError(409, 'conflict', message);

export function deliveriesRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock } = deps;
  const auth = [requireUser(deps), requireVerified];

  router.get('/api/v1/channels/:id/deliveries', ...auth, async (req, res) => {
    const { id } = channelParamsSchema.parse(req.params);
    const q = deliveriesQuerySchema.parse(req.query);
    await myChannel(db, getAuth(res).user.id, id);
    const conditions = [eq(delivery.channelId, id)];
    if (q.cursor) {
      const [createdAt, deliveryId] = parseCursor(q.cursor, cursorShape);
      conditions.push(
        sql`(${delivery.createdAt}, ${delivery.id}) < (${createdAt}::timestamptz, ${deliveryId}::uuid)`,
      );
    }
    const rows = await db
      .select({ ...getTableColumns(delivery), deviceId: outage.deviceId })
      .from(delivery)
      .innerJoin(outage, eq(outage.id, delivery.outageId))
      .where(and(...conditions))
      .orderBy(desc(delivery.createdAt), desc(delivery.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    res.json({
      items: items.map((row) => toDeliveryItem(row, row.deviceId)),
      next_cursor:
        rows.length > q.limit && last
          ? encodeCursor([last.createdAt.toISOString(), last.id])
          : null,
    });
  });

  router.post(
    '/api/v1/deliveries/:id/redeliver',
    ...auth,
    rateLimit(deps.rateLimiter, 'redeliver', { user: REDELIVER_PER_USER }),
    async (req, res) => {
      const { id } = deliveryParamsSchema.parse(req.params);
      const [found] = await db
        .select({
          deviceId: outage.deviceId,
          type: notificationChannel.type,
          enabled: notificationChannel.enabled,
        })
        .from(delivery)
        .innerJoin(notificationChannel, eq(notificationChannel.id, delivery.channelId))
        .innerJoin(outage, eq(outage.id, delivery.outageId))
        .where(and(eq(delivery.id, id), eq(notificationChannel.userId, getAuth(res).user.id)));
      if (!found) throw new HttpError(404, 'not_found', 'Not found');
      if (found.type !== 'WEBHOOK') throw conflict('Only webhook deliveries can be sent again');
      if (!found.enabled) throw conflict('Turn the channel on first');
      const [queued] = await db
        .update(delivery)
        .set({
          status: 'QUEUED',
          attempts: 0,
          nextAttemptAt: clock.now(),
          lastError: null,
          sentAt: null,
        })
        .where(and(eq(delivery.id, id), inArray(delivery.status, ['SENT', 'FAILED'])))
        .returning();
      if (!queued) throw conflict('This delivery is still in progress');
      res.status(202).json(toDeliveryItem(queued, found.deviceId));
    },
  );

  return router;
}
