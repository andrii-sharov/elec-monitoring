import { languages } from '@elec/shared';
import { z } from 'zod';

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
