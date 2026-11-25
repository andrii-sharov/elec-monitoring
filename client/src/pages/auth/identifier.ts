import { emailSchema, isEmailInput } from '@elec/shared/api';
import { z } from 'zod';
import type { ApiError } from '@/api/errors';

export const identifierValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .refine((value) => !isEmailInput(value) || emailSchema.safeParse(value).success, {
    params: { reason: 'email' },
  });

export function toIdentifier(value: string): { email: string } | { phone: string } {
  return isEmailInput(value) ? { email: value } : { phone: value };
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
