import {
  channelIdsSchema,
  channelListSchema,
  channelPatchSchema,
  channelSchema,
  channelWithSecretSchema,
  createWebhookSchema,
  deviceIdsSchema,
  deviceParamsSchema,
  MAX_WEBHOOKS,
  putChannelIdsSchema,
  putDeviceIdsSchema,
  telegramLinkSchema,
} from '@elec/shared/api';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Language } from '@elec/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import {
  expireOneTimeTokens,
  issueOneTimeToken,
  ONE_TIME_TTL_S,
} from '../../auth/oneTimeTokens.ts';
import { toChannel, webhookSecret, type ChannelRow } from '../../channels/views.ts';
import type { Executor } from '../../db/client.ts';
import { appUser, deviceChannel, notificationChannel } from '../../db/schema/index.ts';
import { getAccessibleDevice } from '../../devices/access.ts';
import { accessibleDeviceIds } from '../../devices/queries.ts';
import { createI18n } from '../../i18n.ts';
import { encrypt, newId, randomToken } from '../../lib/crypto.ts';
import { telegramT } from '../../telegram/html.ts';
import {
  CHANNEL_TEST_PER_USER,
  TELEGRAM_LINK_PER_USER,
  WEBHOOK_URL_PER_USER,
} from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser, requireVerified } from '../auth/middleware.ts';
import { bearer, deviceIdParam, deviceNotFound, unauthorized } from '../devices/devices.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';

export const channelParamsSchema = z.object({ id: z.uuid() });

const channelNotFound = () => new HttpError(404, 'not_found', 'Not found');
const needsTestFirst = () =>
  new HttpError(409, 'conflict', 'Send a test message to turn this channel back on');

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
    post: {
      summary: 'Add a webhook',
      description: `The \`secret\` that signs requests is returned only here and by rotate. The new channel is attached to no devices. At most ${MAX_WEBHOOKS} webhooks per user. Creating a webhook and changing a webhook URL share a limit of ${WEBHOOK_URL_PER_USER.limit} per minute.`,
      security: bearer,
      requestBody: { content: json(createWebhookSchema) },
      responses: {
        '201': {
          description: 'The channel with its secret',
          content: json(channelWithSecretSchema),
        },
        '400': errorResponse('Invalid body or `url_not_allowed`'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '409': errorResponse('Webhook limit reached'),
        '429': errorResponse('Too many requests'),
      },
    },
  },
  '/api/v1/channels/{id}': {
    patch: {
      summary: 'Edit, turn on or turn off one of my channels',
      description: `Turning a channel off sets \`disabled_reason: USER\`, except that a channel disabled after too many failures keeps \`TOO_MANY_FAILURES\`. Turning a disabled channel on resets its failure count. A channel turned off after too many failures turns back on only through a successful test message. \`url\` and \`events\` apply to webhooks only. Editing them keeps the channel state and failure count. Changing \`url\` shares a limit of ${WEBHOOK_URL_PER_USER.limit} per minute with adding a webhook.`,
      security: bearer,
      requestParams: { path: channelParamsSchema },
      requestBody: { content: json(channelPatchSchema) },
      responses: {
        '200': { description: 'The channel', content: json(channelSchema) },
        '400': errorResponse('Invalid body or `url_not_allowed`'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
        '409': errorResponse('Disabled after failures: send a test message instead'),
        '429': errorResponse('Too many requests'),
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
        'Sends a test message now (a signed `ping` request for a webhook). On success a channel disabled after failures turns back on. Limited to 5 per minute.',
      security: bearer,
      requestParams: { path: channelParamsSchema },
      responses: {
        '200': { description: 'Sent; the channel after the test', content: json(channelSchema) },
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
        '409': errorResponse('The messenger or receiver did not accept the message'),
        '429': errorResponse('Too many requests'),
      },
    },
  },
  '/api/v1/channels/{id}/rotate-secret': {
    post: {
      summary: 'Replace the secret of one of my webhooks',
      description:
        'The old secret stops working at once. Queued retries are signed with the new secret.',
      security: bearer,
      requestParams: { path: channelParamsSchema },
      responses: {
        '200': {
          description: 'The channel with its new secret',
          content: json(channelWithSecretSchema),
        },
        '400': errorResponse('Invalid channel ID'),
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '404': errorResponse('Channel not found or not yours'),
        '409': errorResponse('Not a webhook'),
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

export async function myChannel(db: Executor, userId: string, id: string): Promise<ChannelRow> {
  const [row] = await db
    .select()
    .from(notificationChannel)
    .where(and(eq(notificationChannel.id, id), eq(notificationChannel.userId, userId)));
  if (!row) throw channelNotFound();
  return row;
}

async function assertWebhookRoom(db: Executor, userId: string) {
  const [webhooks] = await db
    .select({ n: count() })
    .from(notificationChannel)
    .where(and(eq(notificationChannel.userId, userId), eq(notificationChannel.type, 'WEBHOOK')));
  if ((webhooks?.n ?? 0) >= MAX_WEBHOOKS) {
    throw new HttpError(409, 'conflict', 'Webhook limit reached');
  }
}

async function channelView(db: Executor, row: ChannelRow) {
  return toChannel(row, (await deviceIdsByChannel(db, [row.id])).get(row.id) ?? []);
}

const newWebhookSecret = () => `whsec_${randomToken()}`;

function webhookOnlyFields(patch: { url?: string; events?: string[] }) {
  return (['url', 'events'] as const)
    .filter((path) => patch[path] !== undefined)
    .map((path) => ({ path, code: 'not_allowed' }));
}

export function channelsRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, config } = deps;
  const auth = [requireUser(deps), requireVerified];
  const i18n = createI18n();
  const limitUrlChecks = rateLimit(deps.rateLimiter, 'webhook-url', { user: WEBHOOK_URL_PER_USER });

  async function assertUrlAllowed(url: string) {
    const checked = await deps.webhooks.check(url);
    if (!checked.ok) throw new HttpError(400, 'url_not_allowed', 'This URL is not allowed');
  }

  async function sendTelegramTest(chatId: bigint, language: Language) {
    const text = telegramT(i18n, language)('telegram.channelTest');
    const result = await deps.telegram.sendMessage(chatId, text, { silent: false });
    if (result.type !== 'SENT') {
      throw new HttpError(409, 'conflict', 'The messenger did not accept the message');
    }
  }

  async function sendPing(row: ChannelRow) {
    const result = await deps.webhooks.send({
      url: row.webhookUrl!,
      secret: webhookSecret(config, row),
      event: 'ping',
      deliveryId: newId(),
      body: JSON.stringify({
        event: 'ping',
        channel: { id: row.id, name: row.name },
        sent_at: clock.now().toISOString(),
      }),
    });
    if (result.type !== 'SENT') {
      throw new HttpError(
        409,
        'conflict',
        `The receiver did not accept the request (${result.error})`,
        [{ path: 'url', code: 'delivery_failed', reason: result.error }],
      );
    }
  }

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

  router.post('/api/v1/channels', ...auth, limitUrlChecks, async (req, res) => {
    const { user } = getAuth(res);
    const body = createWebhookSchema.parse(req.body ?? {});
    await assertWebhookRoom(db, user.id);
    await assertUrlAllowed(body.url);
    const secret = newWebhookSecret();
    const row = await db.transaction(async (tx) => {
      await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(eq(appUser.id, user.id))
        .for('update');
      await assertWebhookRoom(tx, user.id);
      const [created] = await tx
        .insert(notificationChannel)
        .values({
          userId: user.id,
          type: 'WEBHOOK',
          name: body.name,
          webhookUrl: body.url,
          webhookEvents: body.events,
          webhookSecretEnc: encrypt(config.encryptionKey, secret),
        })
        .returning();
      return created!;
    });
    res.status(201).json({ ...toChannel(row), secret });
  });

  router.post('/api/v1/channels/:id/rotate-secret', ...auth, async (req, res) => {
    const { id } = channelParamsSchema.parse(req.params);
    const row = await myChannel(db, getAuth(res).user.id, id);
    if (row.type !== 'WEBHOOK') {
      throw new HttpError(409, 'conflict', 'Only webhooks have a secret');
    }
    const secret = newWebhookSecret();
    const [updated] = await db
      .update(notificationChannel)
      .set({ webhookSecretEnc: encrypt(config.encryptionKey, secret) })
      .where(eq(notificationChannel.id, row.id))
      .returning();
    if (!updated) throw channelNotFound();
    res.json({ ...(await channelView(db, updated)), secret });
  });

  async function updateChannel(
    userId: string,
    id: string,
    changes: Partial<ChannelRow>,
  ): Promise<ChannelRow> {
    const turningOn = changes.enabled === true;
    const turningOff = changes.enabled === false;
    const [updated] = await db
      .update(notificationChannel)
      .set({
        ...changes,
        ...(turningOff && {
          disabledReason: sql`case when ${notificationChannel.disabledReason} = 'TOO_MANY_FAILURES'
            then ${notificationChannel.disabledReason} else 'USER' end`,
        }),
        ...(turningOn && {
          consecutiveFailures: sql`case when ${notificationChannel.enabled}
            then ${notificationChannel.consecutiveFailures} else 0 end`,
        }),
      })
      .where(
        and(
          eq(notificationChannel.id, id),
          turningOn
            ? sql`${notificationChannel.disabledReason} is distinct from 'TOO_MANY_FAILURES'`
            : undefined,
        ),
      )
      .returning();
    if (updated) return updated;
    await myChannel(db, userId, id);
    throw needsTestFirst();
  }

  router.patch('/api/v1/channels/:id', ...auth, async (req, res) => {
    const { user } = getAuth(res);
    const { id } = channelParamsSchema.parse(req.params);
    const patch = channelPatchSchema.parse(req.body ?? {});
    const row = await myChannel(db, user.id, id);
    const notAllowed = row.type === 'WEBHOOK' ? [] : webhookOnlyFields(patch);
    if (notAllowed.length > 0) {
      throw new HttpError(400, 'validation_error', 'Invalid request', notAllowed);
    }
    const changes: Partial<ChannelRow> = {};
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.events !== undefined) changes.webhookEvents = patch.events;
    if (patch.enabled === true && row.disabledReason === 'TOO_MANY_FAILURES') {
      throw needsTestFirst();
    }
    if (patch.enabled !== undefined) {
      changes.enabled = patch.enabled;
      if (patch.enabled) changes.disabledReason = null;
    }
    if (patch.url !== undefined && patch.url !== row.webhookUrl) {
      await limitUrlChecks(req, res, () => {});
      await assertUrlAllowed(patch.url);
      changes.webhookUrl = patch.url;
    }
    const updated = Object.keys(changes).length
      ? await updateChannel(user.id, row.id, changes)
      : row;
    res.json(await channelView(db, updated));
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
      if (row.type === 'WEBHOOK') await sendPing(row);
      else await sendTelegramTest(row.telegramChatId!, user.language as Language);
      const [updated] =
        row.disabledReason === 'TOO_MANY_FAILURES'
          ? await db
              .update(notificationChannel)
              .set({ enabled: true, disabledReason: null, consecutiveFailures: 0 })
              .where(eq(notificationChannel.id, row.id))
              .returning()
          : [row];
      if (!updated) throw channelNotFound();
      res.json(await channelView(db, updated));
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
    if (deleted.length === 0) throw channelNotFound();
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
