import { errorSchema, sessionSchema, type ErrorCode, type Session } from '@elec/shared/api';
import type { z } from 'zod';
import { ApiError, asErrorCode } from './errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type RequestOptions<S extends z.ZodType | undefined> = {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema?: S;
};

export type ResponseOf<S extends z.ZodType | undefined> = S extends z.ZodType ? z.output<S> : void;

export interface ApiClient {
  request<S extends z.ZodType | undefined = undefined>(
    path: string,
    options?: RequestOptions<S>,
  ): Promise<ResponseOf<S>>;
  refresh(): Promise<Session | null>;
  setSession(session: Session | null): void;
  hasSession(): boolean;
}

type ApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  onSessionLost: () => void;
};

const refreshPath = '/api/auth/refresh';
const tokenlessPaths = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  refreshPath,
  '/api/auth/logout',
]);
const conflictRetryMs = 300;
const codesByStatus: Partial<Record<number, ErrorCode>> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'expired',
  429: 'rate_limited',
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterSeconds(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

async function errorFrom(response: Response): Promise<ApiError> {
  const status = response.status;
  const retryAfterS =
    status === 429 ? retryAfterSeconds(response.headers.get('Retry-After')) : null;
  const body = errorSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) {
    return new ApiError({ status, code: codesByStatus[status] ?? 'internal', retryAfterS });
  }
  const { code, message, details = [] } = body.data.error;
  return new ApiError({ status, code: asErrorCode(code), message, details, retryAfterS });
}

async function parseBody(response: Response, schema: z.ZodType | undefined): Promise<unknown> {
  if (!schema) return undefined;
  const invalid = (message: string) =>
    new ApiError({ status: response.status, code: 'invalid_response', message });
  const json: unknown = await response.json().catch(() => {
    throw invalid('Response is not JSON');
  });
  const result = schema.safeParse(json);
  if (!result.success) throw invalid(result.error.message);
  return result.data;
}

function isUnauthorized(error: ApiError): boolean {
  return error.status === 401 && error.code === 'unauthorized';
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, onSessionLost } = options;
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let accessToken: string | null = null;
  let refreshing: Promise<Session | null> | null = null;

  async function send(
    path: string,
    { method = 'GET', body, query = {} }: RequestOptions<z.ZodType | undefined>,
    token: string | null,
  ): Promise<Response> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ Accept: 'application/json' });
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    const init: RequestInit = {
      method,
      headers,
      credentials: path.startsWith('/api/auth/') ? 'include' : 'omit',
    };
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    try {
      return await doFetch(url, init);
    } catch (cause) {
      throw new ApiError({ status: 0, code: 'network', message: String(cause) });
    }
  }

  async function runRefresh(): Promise<Session | null> {
    let response = await send(refreshPath, { method: 'POST' }, null);
    if (response.status === 409) {
      await wait(conflictRetryMs);
      response = await send(refreshPath, { method: 'POST' }, null);
    }
    if (response.status === 401 || response.status === 409) return null;
    if (!response.ok) throw await errorFrom(response);
    const session = (await parseBody(response, sessionSchema)) as Session;
    accessToken = session.access_token;
    return session;
  }

  function refresh(): Promise<Session | null> {
    refreshing ??= runRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function loseSession(): void {
    if (accessToken === null) return;
    accessToken = null;
    onSessionLost();
  }

  async function renewAfter(staleToken: string): Promise<string | null> {
    if (accessToken !== staleToken) return accessToken;
    const session = await refresh();
    if (session) return session.access_token;
    loseSession();
    return null;
  }

  async function request<S extends z.ZodType | undefined = undefined>(
    path: string,
    requestOptions: RequestOptions<S> = {},
  ): Promise<ResponseOf<S>> {
    const token = tokenlessPaths.has(path) ? null : accessToken;
    const response = await send(path, requestOptions, token);
    if (response.ok) return (await parseBody(response, requestOptions.schema)) as ResponseOf<S>;
    const error = await errorFrom(response);
    if (token === null || !isUnauthorized(error)) throw error;

    const renewed = await renewAfter(token);
    if (renewed === null) throw error;
    const retried = await send(path, requestOptions, renewed);
    if (retried.ok) return (await parseBody(retried, requestOptions.schema)) as ResponseOf<S>;
    const retryError = await errorFrom(retried);
    if (isUnauthorized(retryError) && accessToken === renewed) loseSession();
    throw retryError;
  }

  return {
    request,
    refresh,
    setSession(session) {
      accessToken = session?.access_token ?? null;
    },
    hasSession() {
      return accessToken !== null;
    },
  };
}
