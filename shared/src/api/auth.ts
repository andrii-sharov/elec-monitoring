import { z } from 'zod';
import { meSchema } from './account.ts';
import {
  emailSchema,
  languageSchema,
  nameSchema,
  passwordSchema,
  timezoneSchema,
} from './common.ts';

export const ACCESS_TOKEN_TTL_S = 900;

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  language: languageSchema,
  timezone: timezoneSchema,
});

export const tokenBodySchema = z.object({ token: z.string().min(1).max(200) });

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const forgotBodySchema = z.object({ email: emailSchema });

export const resetBodySchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});

export const changePasswordBodySchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
});

export const sessionSchema = z
  .object({
    access_token: z.string(),
    expires_in: z.literal(ACCESS_TOKEN_TTL_S),
    user: meSchema,
  })
  .meta({ id: 'Session' });

export type Session = z.infer<typeof sessionSchema>;
