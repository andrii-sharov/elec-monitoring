import { emailSchema, normalizePhone } from '@elec/shared/api';
import { z } from 'zod';
import type { ApiError } from '@/api/errors';
import { isPhoneLike } from '@/forms/phone/phoneText';

const isPhone = (value: string) => normalizePhone(value) !== null;

export const phoneValueSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isPhone, { params: { reason: 'invalid_phone' } });

export const identifierValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .refine((value) => !isPhoneLike(value) || isPhone(value), {
    params: { reason: 'invalid_phone' },
  })
  .refine((value) => isPhoneLike(value) || emailSchema.safeParse(value).success, {
    params: { reason: 'email' },
  });

export function toIdentifier(value: string): { email: string } | { phone: string } {
  return isPhoneLike(value) ? { phone: value } : { email: value };
}

export function identifierErrors(error: ApiError): Pick<ApiError, 'details'> {
  return {
    details: error.details.map((detail) =>
      detail.path === 'email' || detail.path === 'phone'
        ? { ...detail, path: 'identifier' }
        : detail,
    ),
  };
}
