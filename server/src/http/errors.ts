import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, z, type core } from 'zod';
import type { Logger } from '../logger.ts';

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'jwt_required'
  | 'insufficient_scope'
  | 'email_not_verified'
  | 'not_found'
  | 'conflict'
  | 'expired'
  | 'rate_limited'
  | 'internal';

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

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function toDetail(issue: core.$ZodIssue): ErrorDetail {
  const detail: ErrorDetail = { path: issue.path.map(String).join('.'), code: issue.code };
  if (issue.code === 'too_small') detail.min = Number(issue.minimum);
  if (issue.code === 'too_big') detail.max = Number(issue.maximum);
  return detail;
}

function isClientError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('status' in err)) return false;
  return typeof err.status === 'number' && err.status >= 400 && err.status < 500;
}

function toHttpError(err: unknown): HttpError | undefined {
  if (err instanceof HttpError) return err;
  if (err instanceof ZodError) {
    return new HttpError(400, 'validation_error', 'Invalid request', err.issues.map(toDetail));
  }
  if (isClientError(err)) return new HttpError(400, 'validation_error', 'Invalid request');
  return undefined;
}

export const notFound: RequestHandler = () => {
  throw new HttpError(404, 'not_found', 'Not found');
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const httpError = toHttpError(err);
    if (!httpError) {
      logger.error(err);
      res.status(500).json({ error: { code: 'internal', message: 'Internal error' } });
      return;
    }
    const { status, code, message, details } = httpError;
    res.status(status).json({ error: details ? { code, message, details } : { code, message } });
  };
}
