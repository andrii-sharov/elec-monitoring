import type { ErrorRequestHandler, RequestHandler } from 'express';
import { errorSchema, type ErrorCode, type ErrorDetail } from '@elec/shared/api';
import { ZodError, type core } from 'zod';
import type { Logger } from '../logger.ts';

export type { ErrorCode, ErrorDetail };

export function errorResponse(description: string) {
  return { description, content: { 'application/json': { schema: errorSchema } } };
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: ErrorDetail[],
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

function toDetail(issue: core.$ZodIssue): ErrorDetail {
  const detail: ErrorDetail = { path: issue.path.map(String).join('.'), code: issue.code };
  if (issue.code === 'custom' && typeof issue.params?.reason === 'string') {
    detail.code = issue.params.reason;
  }
  if (issue.code === 'too_small') detail.min = Number(issue.minimum);
  if (issue.code === 'too_big') detail.max = Number(issue.maximum);
  return detail;
}

function closestBranch(issue: core.$ZodIssue): core.$ZodIssue[] {
  if (issue.code !== 'invalid_union') return [issue];
  const [closest] = issue.errors.toSorted((a, b) => a.length - b.length);
  if (!closest) return [issue];
  return closest.flatMap((inner) =>
    closestBranch({ ...inner, path: [...issue.path, ...inner.path] }),
  );
}

function isClientError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('status' in err)) return false;
  return typeof err.status === 'number' && err.status >= 400 && err.status < 500;
}

function toHttpError(err: unknown): HttpError | undefined {
  if (err instanceof HttpError) return err;
  if (err instanceof ZodError) {
    return new HttpError(
      400,
      'validation_error',
      'Invalid request',
      err.issues.flatMap(closestBranch).map(toDetail),
    );
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
    const { status, code, message, details, headers } = httpError;
    if (headers) res.set(headers);
    res.status(status).json({ error: details ? { code, message, details } : { code, message } });
  };
}
