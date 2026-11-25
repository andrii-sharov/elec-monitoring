import {
  createInviteBodySchema,
  deviceParamsSchema,
  deviceSchema,
  inviteParamsSchema,
  invitePreviewSchema,
  inviteSchema,
  invitesSchema,
  inviteTokenParamsSchema,
  languageSchema,
  memberParamsSchema,
  membersSchema,
} from '@elec/shared/api';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { appUser, device, deviceInvite } from '../../db/schema/index.ts';
import { getAccessibleDevice } from '../../devices/access.ts';
import { sendInBackground } from '../../email/sender.ts';
import { renderInviteEmail } from '../../email/templates.ts';
import { createI18n } from '../../i18n.ts';
import { AUTH_PER_IP, INVITE_PER_USER } from '../../rateLimit/limiter.ts';
import { findDeviceView } from '../../devices/queries.ts';
import { listMembers, removeMember } from '../../sharing/members.ts';
import {
  acceptInvite,
  createInvite,
  findInviteByToken,
  isExpired,
  toInvite,
} from '../../sharing/invites.ts';
import type { AppDeps } from '../app.ts';
import { getAuth, requireUser, requireVerifiedEmail } from '../auth/middleware.ts';
import {
  bearer,
  deviceIdParam,
  deviceNotFound,
  ownerOnly,
  unauthorized,
} from '../devices/devices.ts';
import { toDevice } from '../devices/views.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';

const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const expired = errorResponse('`expired`: unknown, revoked or expired invite');

export const sharingPaths: ZodOpenApiPathsObject = {
  '/api/v1/devices/{id}/members': {
    get: {
      summary: 'List the owner and viewers',
      description:
        'Owner first, then viewers by join time. Emails are shown to the owner, and to each member for their own row.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      responses: {
        '200': { description: 'Members', content: json(membersSchema) },
        '401': unauthorized,
        '404': deviceNotFound,
      },
    },
  },
  '/api/v1/devices/{id}/members/{userId}': {
    delete: {
      summary: 'Remove a viewer or leave',
      description:
        "The owner removes any viewer; a viewer removes only themselves. Also detaches the member's channels from the device.",
      security: bearer,
      requestParams: { path: memberParamsSchema },
      responses: {
        '204': { description: 'Removed' },
        '401': unauthorized,
        '403': errorResponse('`forbidden`: a viewer removing someone else'),
        '404': errorResponse('Device or member not found'),
        '409': errorResponse('The owner cannot be removed'),
      },
    },
  },
  '/api/v1/devices/{id}/invites': {
    post: {
      summary: 'Invite a viewer by email',
      description:
        'Owner only. Emails a link valid for 7 days. Inviting the same email again replaces the earlier link. At most 10 viewers and pending invites per device.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      requestBody: { content: json(createInviteBodySchema) },
      responses: {
        '201': { description: 'The pending invite', content: json(inviteSchema) },
        '400': errorResponse('Invalid body'),
        '401': unauthorized,
        '403': errorResponse('`forbidden` (not the owner) or `email_not_verified`'),
        '404': deviceNotFound,
        '409': errorResponse('Already a member, or the member limit is reached'),
        '429': errorResponse('Too many invites'),
      },
    },
    get: {
      summary: 'List pending invites',
      description: 'Owner only. Expired invites are included, oldest first.',
      security: bearer,
      requestParams: { path: deviceParamsSchema },
      responses: {
        '200': { description: 'Pending invites', content: json(invitesSchema) },
        '401': unauthorized,
        '403': ownerOnly,
        '404': deviceNotFound,
      },
    },
  },
  '/api/v1/devices/{id}/invites/{inviteId}': {
    delete: {
      summary: 'Revoke an invite',
      description: 'Owner only. The invite link stops working.',
      security: bearer,
      requestParams: { path: inviteParamsSchema },
      responses: {
        '204': { description: 'Revoked' },
        '401': unauthorized,
        '403': ownerOnly,
        '404': errorResponse('Device or invite not found'),
      },
    },
  },
  '/api/v1/invites/{token}': {
    get: {
      summary: 'Preview an invite',
      description: 'No auth. Shows who invited whom to which device.',
      requestParams: { path: inviteTokenParamsSchema },
      responses: {
        '200': { description: 'The invite', content: json(invitePreviewSchema) },
        '410': expired,
        '429': errorResponse('Too many requests'),
      },
    },
  },
  '/api/v1/invites/{token}/accept': {
    post: {
      summary: 'Accept an invite',
      description:
        "The account email must match the invite. Joins the device as a viewer, attaches all of the caller's channels and marks the email verified. Accepting again returns the device.",
      security: bearer,
      requestParams: { path: inviteTokenParamsSchema },
      responses: {
        '200': { description: 'The shared device', content: json(deviceSchema) },
        '401': unauthorized,
        '403': errorResponse('`forbidden`: the invite is for another email address'),
        '410': expired,
      },
    },
  },
};

export function sharingRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, logger, config } = deps;
  const i18n = createI18n();
  const auth = requireUser(deps);

  router.get('/api/v1/devices/:id/members', auth, async (req, res) => {
    const id = deviceIdParam(req);
    const { user } = getAuth(res);
    const { role } = await getAccessibleDevice(db, user.id, id, 'read');
    res.json({ items: await listMembers(db, id, { id: user.id, role }) });
  });

  router.delete('/api/v1/devices/:id/members/:userId', auth, async (req, res) => {
    const { id, userId } = memberParamsSchema.parse(req.params);
    const { user } = getAuth(res);
    await db.transaction(async (tx) => {
      const access = await getAccessibleDevice(tx, user.id, id, 'read', { lock: true });
      if (access.role === 'VIEWER' && userId !== user.id) {
        throw new HttpError(403, 'forbidden', 'Viewers can only remove themselves');
      }
      if (userId === access.device.ownerId) {
        throw new HttpError(409, 'conflict', 'The owner cannot be removed');
      }
      if (!(await removeMember(tx, id, userId))) {
        throw new HttpError(404, 'not_found', 'Member not found');
      }
    });
    res.status(204).end();
  });

  router.post(
    '/api/v1/devices/:id/invites',
    auth,
    requireVerifiedEmail,
    rateLimit(deps.rateLimiter, 'invite', { user: INVITE_PER_USER }),
    async (req, res) => {
      const { user } = getAuth(res);
      const id = deviceIdParam(req);
      const { email } = createInviteBodySchema.parse(req.body ?? {});
      const { invite, token, deviceName } = await db.transaction(async (tx) => {
        const access = await getAccessibleDevice(tx, user.id, id, 'manage', { lock: true });
        const created = await createInvite(tx, clock, { deviceId: id, email, invitedBy: user.id });
        return { ...created, deviceName: access.device.name };
      });
      res.status(201).json(toInvite(invite));

      const [account] = await db
        .select({ language: appUser.language })
        .from(appUser)
        .where(eq(sql`lower(${appUser.email})`, email));
      const rendered = renderInviteEmail(i18n, {
        lang: languageSchema.catch('uk').parse(account?.language ?? 'uk'),
        inviter: user.name,
        device: deviceName,
        link: `${config.urls.client}/invite?token=${token}`,
      });
      sendInBackground(deps.email, logger, { to: email, ...rendered });
    },
  );

  router.get('/api/v1/devices/:id/invites', auth, async (req, res) => {
    const id = deviceIdParam(req);
    await getAccessibleDevice(db, getAuth(res).user.id, id, 'manage');
    const rows = await db
      .select()
      .from(deviceInvite)
      .where(and(eq(deviceInvite.deviceId, id), isNull(deviceInvite.acceptedAt)))
      .orderBy(asc(deviceInvite.createdAt), asc(deviceInvite.id));
    res.json({ items: rows.map(toInvite) });
  });

  router.delete('/api/v1/devices/:id/invites/:inviteId', auth, async (req, res) => {
    const { id, inviteId } = inviteParamsSchema.parse(req.params);
    await getAccessibleDevice(db, getAuth(res).user.id, id, 'manage');
    const deleted = await db
      .delete(deviceInvite)
      .where(
        and(
          eq(deviceInvite.id, inviteId),
          eq(deviceInvite.deviceId, id),
          isNull(deviceInvite.acceptedAt),
        ),
      )
      .returning({ id: deviceInvite.id });
    if (deleted.length === 0) throw new HttpError(404, 'not_found', 'Invite not found');
    res.status(204).end();
  });

  router.get(
    '/api/v1/invites/:token',
    rateLimit(deps.rateLimiter, 'invite-preview', { ip: AUTH_PER_IP }),
    async (req, res) => {
      const { token } = inviteTokenParamsSchema.parse(req.params);
      const invite = await findInviteByToken(db, token);
      if (!invite || isExpired(invite, clock.now())) {
        throw new HttpError(410, 'expired', 'The invite is invalid or has expired');
      }
      const [row] = await db
        .select({ deviceName: device.name, inviterName: appUser.name })
        .from(device)
        .innerJoin(appUser, eq(appUser.id, invite.invitedBy))
        .where(eq(device.id, invite.deviceId));
      if (!row) throw new HttpError(410, 'expired', 'The invite is invalid or has expired');
      res.json({
        device_name: row.deviceName,
        inviter_name: row.inviterName,
        email: invite.email,
        expires_at: invite.expiresAt.toISOString(),
        accepted: invite.acceptedAt !== null,
      });
    },
  );

  router.post('/api/v1/invites/:token/accept', auth, async (req, res) => {
    const { token } = inviteTokenParamsSchema.parse(req.params);
    const { user } = getAuth(res);
    const joined = await db.transaction((tx) => acceptInvite(tx, clock, token, user));
    const view = await findDeviceView(db, joined.deviceId, joined.role);
    if (!view) throw new HttpError(410, 'expired', 'The invite is invalid or has expired');
    res.json(toDevice(view));
  });

  return router;
}
