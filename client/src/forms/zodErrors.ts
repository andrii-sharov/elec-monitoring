import type { i18n, TFunction } from 'i18next';
import { z } from 'zod';
import type { ApiError } from '../api/errors.ts';

type Issue = z.core.$ZodIssue | z.core.$ZodRawIssue;

function lengthKey(origin: string): 'string' | 'number' {
  return origin === 'string' ? 'string' : 'number';
}

export function translateIssue(issue: Issue, t: TFunction): string {
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string' && issue.minimum === 1) return t('app.validation.required');
      return t(`app.validation.too_small_${lengthKey(issue.origin)}`, { min: issue.minimum });
    case 'too_big':
      return t(`app.validation.too_big_${lengthKey(issue.origin)}`, { max: issue.maximum });
    case 'invalid_format':
      return issue.format === 'email' ? t('app.validation.email') : t('app.validation.invalid');
    case 'custom': {
      const reason: unknown = issue.params?.reason;
      return typeof reason === 'string'
        ? t(`app.validation.${reason}`, { defaultValue: t('app.validation.invalid') })
        : t('app.validation.invalid');
    }
    default:
      return t('app.validation.invalid');
  }
}

export function installZodErrors(instance: i18n): void {
  z.config({ customError: (issue) => translateIssue(issue, instance.t.bind(instance)) });
}

function translateDetail(detail: ApiError['details'][number], t: TFunction): string {
  if (detail.code === 'too_small' && detail.min === 1) return t('app.validation.required');
  if (detail.code === 'too_small') return t('app.validation.too_small_number', { min: detail.min });
  if (detail.code === 'too_big') return t('app.validation.too_big_number', { max: detail.max });
  return t(`app.validation.${detail.code}`, { defaultValue: t('app.validation.invalid') });
}

export function applyServerErrors(
  error: ApiError,
  setError: (name: never, error: { type: string; message: string }) => void,
  fields: readonly string[],
  t: TFunction,
): boolean {
  let allMapped = error.details.length > 0;
  for (const detail of error.details) {
    const field = detail.path.replace(/^settings\./, '');
    if (!fields.includes(field)) {
      allMapped = false;
      continue;
    }
    setError(field as never, { type: 'server', message: translateDetail(detail, t) });
  }
  return allMapped;
}
