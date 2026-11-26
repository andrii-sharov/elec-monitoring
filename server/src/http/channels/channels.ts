import {
  channelIdsSchema,
  channelListSchema,
  channelPatchSchema,
  channelSchema,
  deviceIdsSchema,
  deviceParamsSchema,
  putChannelIdsSchema,
  putDeviceIdsSchema,
  telegramLinkSchema,
} from '@elec/shared/api';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Language } from '@elec/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import {
  expireOneTimeTokens,
  issueOneTimeToken,
  ONE_TIME_TTL_S,
} from '../../auth/oneTimeTokens.ts';
import { toChannel, type ChannelRow } from '../../channels/views.ts';
import type { Executor } from '../../db/client.ts';
import { deviceChannel, notificationChannel } from '../../db/schema/index.ts';
import { getAccessibleDevice } from '../../devices/access.ts';
import { accessibleDeviceIds } from '../../devices/queries.ts';
import { createI18n } from '../../i18n.ts';
import { telegramT } from '../../telegram/html.ts';
import { CHANNEL_TEST_PER_USER, TELEGRAM_LINK_PER_USER } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser, requireVerified } from '../auth/middleware.ts';
import { bearer, deviceIdParam, deviceNotFound, unauthorized } from '../devices/devices.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';

const channelParamsSchema = z.object({ id: z.uuid() });

const json = (schema: z.ZodType) => ({ 'application/json': { schema } });

export const channelsPaths: ZodOpenApiPathsObject = {
  '/api/v1/channels/telegram-link': {
    post: {
      summary: 'Link the platform Telegram bot',
      description:
        'Returns a link valid for 15 minutes. Pressing **Start** in the bot creates a channel and attaches it to every device you own. An earlier unused link stops working.',
      security: bearer,
      responses: {
        '201': { description: 'Bot links', content: json(telegramLinkSchema) },
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
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
          content: json(channelListSchema),
        },
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
      },
    },
  },
  '/api/v1/channels/{id}': {
    patch: {
      summary: 'Rename, turn on or turn off one of my channels',
      description:
        'Turning a channel off sets `disabled_reason: USER`. A channel turned off after too many failures turns back on only through a successful test message.',
      security: bearer,
      requestParams: { path: channelParamsSchema },
      requestBody: { content: json(channelPatchSchema) },
      responses: {
        '200': { description: 'The channel', content: json(channelSchema) },
        '400': errorResponse('Invalid body'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
        '409': errorResponse('Disabled after failures: send a test message instead'),
      },
    },
    delete: {
      summary: 'Delete one of my channels',
      description:
        'Removes the channel with its device links and delivery log. Nothing is sent to Telegram.',
      security: bearer,
      requestParams: { path: channelParamsSchema },
      responses: {
        '204': { description: 'Deleted' },
        '400': errorResponse('Invalid channel ID'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
      },
    },
  },
  '/api/v1/channels/{id}/devices': {
    put: {
      summary: 'Set which devices send to one of my channels',
      description:
        "Replaces this channel's device links. Every ID must be a device you own or view. At most 100 IDs.",
      security: bearer,
      requestParams: { path: channelParamsSchema },
      requestBody: { content: json(putDeviceIdsSchema) },
      responses: {
        '200': { description: 'The new set', content: json(deviceIdsSchema) },
        '400': errorResponse('Invalid body or unknown device'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
      },
    },
  },
  '/api/v1/channels/{id}/test': {
    post: {
      summary: 'Send a test message to one of my channels',
      description:
        'Sends a test message now. On success a channel disabled after failures turns back on. Limited to 5 per minute.',
      security: bearer,
      requestParams: { path: channelParamsSchema },
      responses: {
        '200': { description: 'Sent; the channel after the test', content: json(channelSchema) },
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
        '409': errorResponse('The messenger did not accept the message'),
        '429': errorResponse('Too many requests'),
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
      requestBody: { content: json(putChannelIdsSchema) },
      responses: {
        '200': { description: 'The new set', content: json(channelIdsSchema) },
        '400': errorResponse('Invalid body or unknown channel'),
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
  },
};

async function deviceIdsByChannel(db: Executor, channelIds: string[]) {
  const links = channelIds.length
    ? await db
        .select({ channelId: deviceChannel.channelId, deviceId: deviceChannel.deviceId })
        .from(deviceChannel)
        .where(inArray(deviceChannel.channelId, channelIds))
        .orderBy(asc(deviceChannel.createdAt), asc(deviceChannel.deviceId))
    : [];
  const byChannel = new Map<string, string[]>();
  for (const link of links) {
    byChannel.set(link.channelId, [...(byChannel.get(link.channelId) ?? []), link.deviceId]);
  }
  return byChannel;
}

async function myChannel(db: Executor, userId: string, id: string): Promise<ChannelRow> {
  const [row] = await db
    .select()
    .from(notificationChannel)
    .where(and(eq(notificationChannel.id, id), eq(notificationChannel.userId, userId)));
  if (!row) throw new HttpError(404, 'not_found', 'Not found');
  return row;
}

async function channelView(db: Executor, row: ChannelRow) {
  return toChannel(row, (await deviceIdsByChannel(db, [row.id])).get(row.id) ?? []);
}

export function channelsRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, config } = deps;
  const auth = [requireUser(deps), requireVerified];
  const i18n = createI18n();

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
    const devices = await deviceIdsByChannel(
      db,
      rows.map((row) => row.id),
    );
    res.json({ items: rows.map((row) => toChannel(row, devices.get(row.id) ?? [])) });
  });

  router.patch('/api/v1/channels/:id', ...auth, async (req, res) => {
    const { id } = channelParamsSchema.parse(req.params);
    const patch = channelPatchSchema.parse(req.body ?? {});
    const row = await myChannel(db, getAuth(res).user.id, id);
    const changes: Partial<ChannelRow> = {};
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.enabled === true && row.disabledReason === 'TOO_MANY_FAILURES') {
      throw new HttpError(409, 'conflict', 'Send a test message to turn this channel back on');
    }
    if (patch.enabled !== undefined) {
      changes.enabled = patch.enabled;
      changes.disabledReason = patch.enabled ? null : 'USER';
    }
    const [updated] = await db
      .update(notificationChannel)
      .set(changes)
      .where(eq(notificationChannel.id, row.id))
      .returning();
    res.json(await channelView(db, updated!));
  });

  router.put('/api/v1/channels/:id/devices', ...auth, async (req, res) => {
    const { user } = getAuth(res);
    const { id } = channelParamsSchema.parse(req.params);
    const { device_ids } = putDeviceIdsSchema.parse(req.body ?? {});
    await myChannel(db, user.id, id);
    const unique = [...new Set(device_ids)];
    await db.transaction(async (tx) => {
      const allowed = await accessibleDeviceIds(tx, user.id);
      const details = device_ids.flatMap((deviceId, index) =>
        allowed.has(deviceId) || device_ids.indexOf(deviceId) !== index
          ? []
          : [{ path: `device_ids.${index}`, code: 'not_found' }],
      );
      if (details.length > 0) {
        throw new HttpError(400, 'validation_error', 'Invalid request', details);
      }
      await tx.delete(deviceChannel).where(eq(deviceChannel.channelId, id));
      if (unique.length > 0) {
        await tx
          .insert(deviceChannel)
          .values(unique.map((deviceId) => ({ deviceId, channelId: id })));
      }
    });
    res.json({ device_ids: unique });
  });

  router.post(
    '/api/v1/channels/:id/test',
    ...auth,
    rateLimit(deps.rateLimiter, 'channel-test', { user: CHANNEL_TEST_PER_USER }),
    async (req, res) => {
      const { user } = getAuth(res);
      const { id } = channelParamsSchema.parse(req.params);
      const row = await myChannel(db, user.id, id);
      if (row.type !== 'TELEGRAM_PLATFORM' || row.telegramChatId === null) {
        throw new HttpError(409, 'conflict', 'Test messages are not available for this channel');
      }
      const text = telegramT(i18n, user.language as Language)('telegram.channelTest');
      const result = await deps.telegram.sendMessage(row.telegramChatId, text, { silent: false });
      if (result.type !== 'SENT') {
        throw new HttpError(409, 'conflict', 'The messenger did not accept the message');
      }
      const [updated] =
        row.disabledReason === 'TOO_MANY_FAILURES'
          ? await db
              .update(notificationChannel)
              .set({ enabled: true, disabledReason: null, consecutiveFailures: 0 })
              .where(eq(notificationChannel.id, row.id))
              .returning()
          : [row];
      res.json(await channelView(db, updated!));
    },
  );

  router.delete('/api/v1/channels/:id', ...auth, async (req, res) => {
    const { id } = channelParamsSchema.parse(req.params);
    const deleted = await db
      .delete(notificationChannel)
      .where(
        and(eq(notificationChannel.id, id), eq(notificationChannel.userId, getAuth(res).user.id)),
      )
      .returning({ id: notificationChannel.id });
    if (deleted.length === 0) throw new HttpError(404, 'not_found', 'Not found');
    res.status(204).end();
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
    const { channel_ids } = putChannelIdsSchema.parse(req.body ?? {});
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
