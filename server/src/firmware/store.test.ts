import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { fsStore, memoryStore, supabaseStore, type StoredFile } from './store.ts';

const config = { url: 'https://proj.supabase.co', secretKey: 'sb_secret_x', bucket: 'firmware' };

type Call = { url: string; init: RequestInit };

function fakeFetch(response: () => Response): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function read(file: StoredFile | null): Promise<Uint8Array> {
  if (!file) throw new Error('expected a file');
  return new Uint8Array(await new Response(file.body).arrayBuffer());
}

describe('supabaseStore', () => {
  test('get streams the object with service credentials', async () => {
    const { fetchFn, calls } = fakeFetch(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } }),
    );
    const file = await supabaseStore(config, fetchFn).get('2.0.0/factory.bin');
    expect(calls[0]!.url).toBe(
      'https://proj.supabase.co/storage/v1/object/firmware/2.0.0/factory.bin',
    );
    expect(calls[0]!.init.method ?? 'GET').toBe('GET');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get('authorization')).toBe('Bearer sb_secret_x');
    expect(headers.get('apikey')).toBe('sb_secret_x');
    expect(file?.size).toBe(3);
    expect(await read(file)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('get returns null for a missing object', async () => {
    const { fetchFn } = fakeFetch(() => new Response('not found', { status: 404 }));
    expect(await supabaseStore(config, fetchFn).get('2.0.0/app.bin')).toBeNull();
  });

  test('get returns null for the legacy 400 not-found body', async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({ statusCode: '404', error: 'not_found' }, { status: 400 }),
    );
    expect(await supabaseStore(config, fetchFn).get('2.0.0/app.bin')).toBeNull();
  });

  test('get throws on a server error', async () => {
    const { fetchFn } = fakeFetch(() => new Response('boom', { status: 503 }));
    await expect(supabaseStore(config, fetchFn).get('2.0.0/app.bin')).rejects.toThrow(/503/);
  });

  test('put uploads with upsert', async () => {
    const { fetchFn, calls } = fakeFetch(() => Response.json({ Key: 'x' }));
    await supabaseStore(config, fetchFn).put('2.0.0/app.bin', new Uint8Array([9]));
    expect(calls[0]!.url).toBe('https://proj.supabase.co/storage/v1/object/firmware/2.0.0/app.bin');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get('x-upsert')).toBe('true');
    expect(headers.get('content-type')).toBe('application/octet-stream');
    expect(headers.get('authorization')).toBe('Bearer sb_secret_x');
    expect(calls[0]!.init.body).toEqual(new Uint8Array([9]));
  });

  test('put throws with the status and Supabase message when the upload fails', async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({ statusCode: '404', error: 'Bucket not found' }, { status: 404 }),
    );
    await expect(
      supabaseStore(config, fetchFn).put('2.0.0/app.bin', new Uint8Array([9])),
    ).rejects.toThrow(/404.*Bucket not found/);
  });

  test('rejects unsafe paths without calling fetch', async () => {
    const { fetchFn, calls } = fakeFetch(() => new Response(''));
    await expect(supabaseStore(config, fetchFn).get('../secrets')).rejects.toThrow(/path/);
    expect(calls).toHaveLength(0);
  });
});

describe('fsStore', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('writes and reads files under the directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fw-'));
    const store = fsStore(dir);
    await store.put('2.0.0/app.bin', new Uint8Array([4, 5]));
    const file = await store.get('2.0.0/app.bin');
    expect(file?.size).toBe(2);
    expect(await read(file)).toEqual(new Uint8Array([4, 5]));
    expect(await store.get('2.0.0/missing.bin')).toBeNull();
  });

  test.each(['../x', '2.0.0/../../x', '/etc/passwd', '', '2.0.0\\..\\x'])(
    'rejects %j',
    async (path) => {
      dir = await mkdtemp(join(tmpdir(), 'fw-'));
      const store = fsStore(dir);
      await expect(store.get(path)).rejects.toThrow(/path/);
      await expect(store.put(path, new Uint8Array([1]))).rejects.toThrow(/path/);
    },
  );
});

describe('memoryStore', () => {
  test('keeps files in a map', async () => {
    const store = memoryStore();
    await store.put('2.0.0/app.bin', new Uint8Array([7]));
    expect(store.files.get('2.0.0/app.bin')).toEqual(new Uint8Array([7]));
    expect(await read(await store.get('2.0.0/app.bin'))).toEqual(new Uint8Array([7]));
    expect(await store.get('nope')).toBeNull();
  });
});
