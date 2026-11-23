import { z } from 'zod';
import { languages } from '../enums.ts';

export const errorCodes = [
  'validation_error',
  'unauthorized',
  'forbidden',
  'jwt_required',
  'insufficient_scope',
  'email_not_verified',
  'not_found',
  'conflict',
  'expired',
  'rate_limited',
  'invalid_credentials',
  'reauth_required',
  'internal',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'not_found' }),
      message: z.string().meta({ example: 'Device not found' }),
      details: z
        .array(
          z.looseObject({
            path: z.string(),
            code: z.string(),
            min: z.number().optional(),
            max: z.number().optional(),
          }),
        )
        .optional(),
    }),
  })
  .meta({ id: 'Error' });

export type ErrorDetail = { path: string; code: string; min?: number; max?: number };

export const isoDate = z.string().meta({ example: '2026-11-21T16:42:00Z' });

export const limitSchema = z.coerce.number().int().min(1).max(100).default(50);

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next_cursor: z.string().nullable() });
}

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const passwordSchema = z.string().min(8).max(128);

export const nameSchema = z.string().trim().min(1).max(100);

export const languageSchema = z.enum(languages);

const knownTimezones = new Map(
  Intl.supportedValuesOf('timeZone').map((zone) => [zone.toLowerCase(), zone]),
);

function canonicalTimezone(timeZone: string): string | null {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  const lower = timeZone.toLowerCase();
  if (resolved.toLowerCase() === lower) return resolved;
  return knownTimezones.get(lower) ?? timeZone;
}

export const timezoneSchema = z
  .string()
  .refine((value) => canonicalTimezone(value) !== null)
  .transform((value) => canonicalTimezone(value) ?? value);
