import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { FirmwareStoreConfig } from '../config.ts';

export type StoredFile = { body: ReadableStream<Uint8Array>; size: number };

export interface FirmwareStore {
  get(path: string): Promise<StoredFile | null>;
  put(path: string, bytes: Uint8Array): Promise<void>;
}

export type SupabaseStoreConfig = { url: string; secretKey: string; bucket: string };

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function checkPath(path: string): string {
  const segments = path.split('/');
  const safe = segments.every((s) => SAFE_SEGMENT.test(s) && s !== '.' && s !== '..');
  if (!safe) throw new Error(`Unsafe firmware path: ${JSON.stringify(path)}`);
  return path;
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function isLegacyNotFound(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  const body: unknown = await res.json().catch(() => null);
  return (
    typeof body === 'object' && body !== null && 'statusCode' in body && body.statusCode === '404'
  );
}

export function supabaseStore(
  c: SupabaseStoreConfig,
  fetchFn: typeof fetch = fetch,
): FirmwareStore {
  const base = `${c.url.replace(/\/$/, '')}/storage/v1/object/${c.bucket}`;
  const auth = { authorization: `Bearer ${c.secretKey}`, apikey: c.secretKey };

  return {
    async get(path) {
      const res = await fetchFn(`${base}/${checkPath(path)}`, { method: 'GET', headers: auth });
      if (res.status === 404 || (await isLegacyNotFound(res))) return null;
      if (!res.ok || !res.body) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`Firmware store get failed: ${res.status} ${detail}`.trim());
      }
      return { body: res.body, size: Number(res.headers.get('content-length') ?? 0) };
    },
    async put(path, bytes) {
      const res = await fetchFn(`${base}/${checkPath(path)}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/octet-stream', 'x-upsert': 'true' },
        body: new Uint8Array(bytes),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`Firmware store put failed: ${res.status} ${detail}`.trim());
      }
    },
  };
}

export function fsStore(dir: string): FirmwareStore {
  return {
    async get(path) {
      const file = join(dir, checkPath(path));
      const info = await stat(file).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      if (!info?.isFile()) return null;
      const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
      return { body, size: info.size };
    },
    async put(path, bytes) {
      const file = join(dir, checkPath(path));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
  };
}

export function memoryStore(): FirmwareStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async get(path) {
      const bytes = files.get(checkPath(path));
      return bytes ? { body: bytesStream(bytes), size: bytes.length } : null;
    },
    async put(path, bytes) {
      files.set(checkPath(path), bytes);
    },
  };
}

export function createFirmwareStore(c: FirmwareStoreConfig): FirmwareStore {
  return c.store === 'fs' ? fsStore(c.dir) : supabaseStore(c);
}
