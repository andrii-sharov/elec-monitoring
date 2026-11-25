import { z } from 'zod';
import { meSchema } from './account.ts';
import {
  emailSchema,
  identifierSchema,
  languageSchema,
  nameSchema,
  passwordSchema,
  phoneSchema,
  timezoneSchema,
  withIdentifier,
} from './common.ts';

export const ACCESS_TOKEN_TTL_S = 900;

export const signupBodySchema = withIdentifier({
  password: passwordSchema,
  name: nameSchema,
  language: languageSchema,
  timezone: timezoneSchema,
});

export const tokenBodySchema = z.object({ token: z.string().min(1).max(200) });

export const loginBodySchema = withIdentifier({ password: z.string().min(1).max(128) });

export const forgotBodySchema = identifierSchema;

export const telegramUrlSchema = z.object({ telegram_url: z.string() }).meta({ id: 'TelegramUrl' });

export type TelegramUrl = z.infer<typeof telegramUrlSchema>;

export const addPhoneBodySchema = z.strictObject({ phone: phoneSchema });

export const addEmailBodySchema = z.strictObject({ email: emailSchema });

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
