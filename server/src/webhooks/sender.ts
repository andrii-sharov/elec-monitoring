import { createHmac } from 'node:crypto';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { checkWebhookUrl, type LookupAll } from './ssrf.ts';

export type WebhookRequest = {
  url: string;
  secret: string;
  event: string;
  deliveryId: string;
  body: string;
};

export type WebhookResult = { type: 'SENT'; status: number } | { type: 'FAILED'; error: string };

export interface WebhookSender {
  send(req: WebhookRequest): Promise<WebhookResult>;
  check(url: string): ReturnType<typeof checkWebhookUrl>;
}

type CheckedUrl = Extract<Awaited<ReturnType<typeof checkWebhookUrl>>, { ok: true }>;

const defaultTimeoutMs = 10_000;
const defaultCheckTimeoutMs = 5_000;
const maxResponseBytes = 1024;
const maxErrorLength = 300;

export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function pinnedLookup(addresses: CheckedUrl['addresses']): LookupFunction {
  return (_host, options, callback) => {
    process.nextTick(() => {
      if (options.all) callback(null, [...addresses]);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

function requestOptions(
  { url, addresses }: CheckedUrl,
  req: WebhookRequest,
  signal: AbortSignal,
): https.RequestOptions {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return {
    hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(req.body),
      'User-Agent': 'ElecMonitor-Webhook/1',
      'X-Elec-Event': req.event,
      'X-Elec-Delivery': req.deliveryId,
      'X-Elec-Signature': signBody(req.secret, req.body),
    },
    agent: false,
    lookup: pinnedLookup(addresses),
    ...(isIP(hostname) ? {} : { servername: hostname }),
    signal,
  };
}

function post(
  request: typeof https.request,
  options: https.RequestOptions,
  body: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request(options, (response) => {
      let received = 0;
      const finish = () => {
        resolve(response.statusCode!);
        outgoing.destroy();
      };
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received >= maxResponseBytes) finish();
      });
      response.on('end', finish);
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

function toResult(status: number): WebhookResult {
  if (status >= 200 && status < 300) return { type: 'SENT', status };
  const redirect = status >= 300 && status < 400 ? ': redirect not followed' : '';
  return { type: 'FAILED', error: `HTTP ${status}${redirect}` };
}

function failed(error: string): WebhookResult {
  return { type: 'FAILED', error: error.slice(0, maxErrorLength) };
}

function networkError(error: unknown): WebhookResult {
  const { message, code } = error as NodeJS.ErrnoException;
  return failed(`network: ${message || code || 'request failed'}`);
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export function createWebhookSender(
  opts: {
    lookup?: LookupAll;
    request?: typeof https.request;
    isAllowed?: (ip: string) => boolean;
    timeoutMs?: number;
    checkTimeoutMs?: number;
  } = {},
): WebhookSender {
  const { lookup, isAllowed, request = https.request, timeoutMs = defaultTimeoutMs } = opts;
  const { checkTimeoutMs = defaultCheckTimeoutMs } = opts;
  const checkUrl = (url: string) => checkWebhookUrl(url, lookup, isAllowed);

  async function deliver(req: WebhookRequest, signal: AbortSignal): Promise<WebhookResult> {
    const checked = await checkUrl(req.url);
    signal.throwIfAborted();
    if (!checked.ok) {
      return failed(checked.reason === 'dns' ? 'DNS lookup failed' : 'address not allowed');
    }
    return toResult(await post(request, requestOptions(checked, req, signal), req.body));
  }

  return {
    check(url) {
      const timedOut = rejectOnAbort(AbortSignal.timeout(checkTimeoutMs)).catch(
        () => ({ ok: false, reason: 'dns' }) as const,
      );
      return Promise.race([checkUrl(url), timedOut]);
    },
    async send(req) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        return await Promise.race([deliver(req, signal), rejectOnAbort(signal)]);
      } catch (error) {
        return signal.aborted ? failed('timeout') : networkError(error);
      }
    },
  };
}
