import { and, asc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import {
  expireOneTimeTokens,
  issueOneTimeToken,
  ONE_TIME_TTL_S,
} from '../../auth/oneTimeTokens.ts';
import { channelSchema, toChannel } from '../../channels/views.ts';
import { deviceChannel, notificationChannel } from '../../db/schema/index.ts';
import { getAccessibleDevice } from '../../devices/access.ts';
import { TELEGRAM_LINK_PER_USER } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser, requireVerifiedEmail } from '../auth/middleware.ts';
import {
  bearer,
  deviceIdParam,
  deviceNotFound,
  deviceParamsSchema,
  unauthorized,
} from '../devices/devices.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';

const MAX_CHANNEL_IDS = 50;

const linkResponseSchema = z.object({
  url: z.string().meta({ example: 'https://t.me/ElecBot?start=abc' }),
  group_url: z.string().meta({ example: 'https://t.me/ElecBot?startgroup=abc' }),
  expires_at: z.string().meta({ example: '2026-11-21T16:57:00Z' }),
});

const channelIdsSchema = z.object({ channel_ids: z.array(z.uuid()) });
const putBodySchema = z.strictObject({ channel_ids: z.array(z.uuid()).max(MAX_CHANNEL_IDS) });
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });

export const channelsPaths: ZodOpenApiPathsObject = {
  '/api/v1/channels/telegram-link': {
    post: {
      summary: 'Link the platform Telegram bot',
      description:
        'Returns a link valid for 15 minutes. Pressing **Start** in the bot creates a channel and attaches it to every device you own. An earlier unused link stops working.',
      security: bearer,
      responses: {
        '201': { description: 'Bot links', content: json(linkResponseSchema) },
        '401': unauthorized,
        '403': errorResponse('`email_not_verified`'),
        '429': errorResponse('Too many requests'),
      },
    },
  },
  '/api/v1/channels': {
    get: {
      summary: 'List my channels',
      security: bearer,
      responses: {
        '200': {
          description: 'Channels, oldest first',
          content: json(z.object({ items: z.array(channelSchema) })),
        },
        '401': unauthorized,
        '403': errorResponse('`email_not_verified`'),
      },
    },
  },
  '/api/v1/devices/{id}/channels': {
    get: {
      summary: 'Channels of mine that this device notifies',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      responses: {
        '200': { description: 'Channel IDs', content: json(channelIdsSchema) },
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
    put: {
      summary: 'Set which of my channels this device notifies',
      description:
        'Replaces only your own links. Other users keep theirs. At most 50 IDs, and every ID must be one of your channels.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      requestBody: { content: json(putBodySchema) },
      responses: {
        '200': { description: 'The new set', content: json(channelIdsSchema) },
        '400': errorResponse('Invalid body or unknown channel'),
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
  },
};

export function channelsRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, config } = deps;
  const auth = [requireUser(deps), requireVerifiedEmail];

  router.post(
    '/api/v1/channels/telegram-link',
    ...auth,
    rateLimit(deps.rateLimiter, 'telegram-link', { user: TELEGRAM_LINK_PER_USER }),
    async (_req, res) => {
      const { user } = getAuth(res);
      const code = await db.transaction(async (tx) => {
        await expireOneTimeTokens(tx, clock, user.id, 'TELEGRAM_LINK');
        return issueOneTimeToken(tx, clock, user.id, 'TELEGRAM_LINK');
      });
      const base = `https://t.me/${config.telegram.botUsername}`;
      const expiresAt = new Date(clock.now().getTime() + ONE_TIME_TTL_S.TELEGRAM_LINK * 1000);
      res.status(201).json({
        url: `${base}?start=${code}`,
        group_url: `${base}?startgroup=${code}`,
        expires_at: expiresAt.toISOString(),
      });
    },
  );

  router.get('/api/v1/channels', ...auth, async (_req, res) => {
    const rows = await db
      .select()
      .from(notificationChannel)
      .where(eq(notificationChannel.userId, getAuth(res).user.id))
      .orderBy(asc(notificationChannel.createdAt), asc(notificationChannel.id));
    res.json({ items: rows.map(toChannel) });
  });

  router.get('/api/v1/devices/:id/channels', ...auth, async (req, res) => {
    const { user } = getAuth(res);
    const id = deviceIdParam(req);
    await getAccessibleDevice(db, user.id, id, 'read');
    const rows = await db
      .select({ id: deviceChannel.channelId })
      .from(deviceChannel)
      .innerJoin(notificationChannel, eq(notificationChannel.id, deviceChannel.channelId))
      .where(and(eq(deviceChannel.deviceId, id), eq(notificationChannel.userId, user.id)))
      .orderBy(asc(deviceChannel.createdAt), asc(deviceChannel.channelId));
    res.json({ channel_ids: rows.map((r) => r.id) });
  });

  router.put('/api/v1/devices/:id/channels', ...auth, async (req, res) => {
    const { user } = getAuth(res);
    const id = deviceIdParam(req);
    const { channel_ids } = putBodySchema.parse(req.body ?? {});
    await getAccessibleDevice(db, user.id, id, 'read');
    const unique = [...new Set(channel_ids)];

    await db.transaction(async (tx) => {
      const mine = unique.length
        ? await tx
            .select({ id: notificationChannel.id })
            .from(notificationChannel)
            .where(
              and(eq(notificationChannel.userId, user.id), inArray(notificationChannel.id, unique)),
            )
        : [];
      const owned = new Set(mine.map((r) => r.id));
      const details = channel_ids.flatMap((channelId, index) =>
        owned.has(channelId) || channel_ids.indexOf(channelId) !== index
          ? []
          : [{ path: `channel_ids.${index}`, code: 'not_found' }],
      );
      if (details.length > 0) {
        throw new HttpError(400, 'validation_error', 'Invalid request', details);
      }

      const myChannels = tx
        .select({ id: notificationChannel.id })
        .from(notificationChannel)
        .where(eq(notificationChannel.userId, user.id));
      await tx
        .delete(deviceChannel)
        .where(and(eq(deviceChannel.deviceId, id), inArray(deviceChannel.channelId, myChannels)));
      if (unique.length > 0) {
        await tx
          .insert(deviceChannel)
          .values(unique.map((channelId) => ({ deviceId: id, channelId })));
      }
    });
    res.json({ channel_ids: unique });
  });

  return router;
}
