import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { resetReasons, type ResetReason } from '@elec/shared';

export type FakeState = {
  api: string;
  deviceId: string;
  token: string;
  bootId: string | null;
  seq: number;
  bootStartedAt: string | null;
  nextEventId: number;
};

type Body = Record<string, unknown>;

const STATE_FILE = '.fake-device.json';
const FW = '2.0.0';

export function nextBoot(
  state: FakeState,
  reason: ResetReason,
  now: Date,
): { state: FakeState; body: Body } {
  const next = {
    ...state,
    bootId: randomUUID(),
    seq: 1,
    bootStartedAt: now.toISOString(),
    nextEventId: 1,
  };
  return {
    state: next,
    body: {
      type: 'BOOT',
      boot_id: next.bootId,
      seq: 1,
      uptime_s: 0,
      reset_reason: reason,
      rssi: -60,
      fw: FW,
    },
  };
}

export function nextPing(
  state: FakeState,
  now: Date,
  wifiDropS?: number,
): { state: FakeState; body: Body } {
  if (!state.bootId || !state.bootStartedAt) throw new Error('Send a boot first: fake-device boot');
  const uptime = Math.floor((now.getTime() - new Date(state.bootStartedAt).getTime()) / 1000);
  const next = { ...state, seq: state.seq + 1 };
  const body: Body = {
    type: 'PING',
    boot_id: state.bootId,
    seq: next.seq,
    uptime_s: uptime,
    reset_reason: 'POWER_ON',
    rssi: -60,
    fw: FW,
  };
  if (wifiDropS !== undefined) {
    const end = Math.max(0, uptime - 5);
    body.wifi = {
      evicted: 0,
      events: [
        {
          id: state.nextEventId,
          kind: 'WIFI',
          start_uptime_s: Math.max(0, end - wifiDropS),
          end_uptime_s: end,
          reason: 201,
        },
      ],
    };
    next.nextEventId = state.nextEventId + 1;
  }
  return { state: next, body };
}

async function loadState(): Promise<FakeState> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as FakeState;
  } catch {
    throw new Error(`No ${STATE_FILE}. Run: fake-device claim <code>`);
  }
}

const saveState = (state: FakeState) =>
  writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

async function post(
  state: Pick<FakeState, 'api' | 'token'>,
  path: string,
  body: Body,
): Promise<Response> {
  return fetch(`${state.api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify(body),
  });
}

async function send(state: FakeState, body: Body): Promise<number> {
  const res = await post(state, '/api/v1/device/ping', body);
  const retryAfter = res.headers.get('Retry-After');
  console.info(
    `${body.type} seq=${String(body.seq)} → ${res.status}${retryAfter ? ` (Retry-After ${retryAfter})` : ''}`,
  );
  if (res.status === 429 && retryAfter) await sleep(Number(retryAfter) * 1000);
  return res.status;
}

function parseReason(value: string | undefined): ResetReason {
  const reason = (value ?? 'POWER_ON').toUpperCase();
  if (!(resetReasons as readonly string[]).includes(reason)) {
    throw new Error(`--reason must be one of ${resetReasons.join(', ')}`);
  }
  return reason as ResetReason;
}

async function main(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      api: { type: 'string' },
      reason: { type: 'string' },
      'wifi-drop': { type: 'string' },
      interval: { type: 'string' },
    },
  });
  const [command, arg] = positionals;

  if (command === 'claim') {
    if (!arg) throw new Error('Usage: fake-device claim <pairing code>');
    const api = values.api ?? process.env.API_URL ?? 'http://localhost:3000';
    const res = await post({ api, token: '' }, '/api/v1/device/claim', {
      pairing_code: arg,
      fw: FW,
    });
    const body = (await res.json()) as { device_id?: string; device_token?: string };
    if (!res.ok || !body.device_token || !body.device_id) {
      throw new Error(`Claim failed: ${res.status} ${JSON.stringify(body)}`);
    }
    await saveState({
      api,
      deviceId: body.device_id,
      token: body.device_token,
      bootId: null,
      seq: 0,
      bootStartedAt: null,
      nextEventId: 1,
    });
    console.info(`claimed device ${body.device_id}, state saved to ${STATE_FILE}`);
    return;
  }

  let state = await loadState();
  if (values.api) state = { ...state, api: values.api };

  if (command === 'boot') {
    const next = nextBoot(state, parseReason(values.reason), new Date());
    await send(next.state, next.body);
    await saveState(next.state);
    return;
  }

  if (command === 'ping') {
    const drop = values['wifi-drop'] === undefined ? undefined : Number(values['wifi-drop']);
    const next = nextPing(state, new Date(), drop);
    await send(next.state, next.body);
    await saveState(next.state);
    return;
  }

  if (command === 'run') {
    const intervalMs = Number(values.interval ?? 30) * 1000;
    const stop = new AbortController();
    process.once('SIGINT', () => {
      stop.abort();
    });
    let next = nextBoot(state, parseReason(values.reason), new Date());
    await send(next.state, next.body);
    await saveState(next.state);
    while (!stop.signal.aborted) {
      try {
        await sleep(intervalMs, undefined, { signal: stop.signal });
      } catch {
        break;
      }
      next = nextPing(next.state, new Date());
      await send(next.state, next.body);
      await saveState(next.state);
    }
    return;
  }

  throw new Error(
    'Usage: fake-device <claim <code> | boot [--reason R] | ping [--wifi-drop S] | run [--interval S]> [--api URL]',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
