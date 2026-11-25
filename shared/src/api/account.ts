import { z } from 'zod';
import { languageSchema, nameSchema, timezoneSchema } from './common.ts';

export const meSchema = z
  .object({
    id: z.string(),
    email: z.string().nullable(),
    email_verified: z.boolean(),
    phone: z.string().nullable(),
    phone_verified: z.boolean(),
    name: z.string(),
    language: languageSchema,
    timezone: z.string(),
    has_password: z.boolean(),
    google_linked: z.boolean(),
    is_admin: z.boolean(),
  })
  .meta({ id: 'Me' });

export type Me = z.infer<typeof meSchema>;

export const mePatchSchema = z.strictObject({
  name: nameSchema.optional(),
  language: languageSchema.optional(),
  timezone: timezoneSchema.optional(),
});

export const meDeleteSchema = z.object({ password: z.string().max(128).optional() });
