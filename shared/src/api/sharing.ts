import { z } from 'zod';
import { deviceRoles } from '../enums.ts';
import { identifierSchema, isoDate } from './common.ts';

export const memberSchema = z
  .object({
    user_id: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    role: z.enum(deviceRoles),
    joined_at: isoDate,
  })
  .meta({ id: 'Member' });

export const membersSchema = z.object({ items: z.array(memberSchema) });

export const inviteSchema = z
  .object({
    id: z.uuid(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    url: z.string().optional(),
    expires_at: isoDate,
    created_at: isoDate,
  })
  .meta({ id: 'Invite' });

export const invitesSchema = z.object({ items: z.array(inviteSchema) });

export const createInviteBodySchema = identifierSchema;

export const invitePreviewSchema = z
  .object({
    device_name: z.string(),
    inviter_name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    expires_at: isoDate,
    accepted: z.boolean(),
  })
  .meta({ id: 'InvitePreview' });

export const memberParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });

export const inviteParamsSchema = z.object({ id: z.uuid(), inviteId: z.uuid() });

export const inviteTokenParamsSchema = z.object({ token: z.string().min(1).max(128) });

export type Member = z.infer<typeof memberSchema>;
export type Invite = z.infer<typeof inviteSchema>;
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
