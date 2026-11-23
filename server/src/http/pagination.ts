import { z } from 'zod';
import { HttpError } from './errors.ts';

export { limitSchema } from '@elec/shared/api';

export function encodeCursor(values: string[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

const cursorValues = z.array(z.string());

export function decodeCursor(cursor: string, arity: number): string[] {
  const invalid = new HttpError(400, 'validation_error', 'Invalid cursor', [
    { path: 'cursor', code: 'invalid_cursor' },
  ]);
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  const values = cursorValues.safeParse(parsed);
  if (!values.success || values.data.length !== arity) throw invalid;
  return values.data;
}
