import { errorCodes, type ErrorCode, type ErrorDetail } from '@elec/shared/api';

export type ApiErrorCode = ErrorCode | 'network' | 'invalid_response';

type ApiErrorInit = {
  status: number;
  code: ApiErrorCode;
  message?: string;
  details?: ErrorDetail[];
  retryAfterS?: number | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: ErrorDetail[];
  readonly retryAfterS: number | null;

  constructor({ status, code, message, details = [], retryAfterS = null }: ApiErrorInit) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterS = retryAfterS;
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export function asErrorCode(value: string): ErrorCode {
  return errorCodes.find((code) => code === value) ?? 'internal';
}
