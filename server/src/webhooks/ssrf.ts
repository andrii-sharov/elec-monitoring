import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type LookupAll = (
  host: string,
  signal?: AbortSignal,
) => Promise<{ address: string; family: 4 | 6 }[]>;

type Addresses = Awaited<ReturnType<LookupAll>>;

type Rejection = 'scheme' | 'credentials' | 'too_long' | 'invalid' | 'dns' | 'address';

const maxUrlLength = 2048;
const maxConcurrentLookups = 2;

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, 'ipv4');
}

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const) {
  blockedIpv6.addSubnet(network, prefix, 'ipv6');
}

const ipv4EmbeddingPrefixes = [
  [0, 0, 0, 0, 0, 0xffff],
  [0x64, 0xff9b, 0, 0, 0, 0],
];

function ipv6Groups(ip: string): number[] {
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const [head = [], tail = []] = canonical
    .split('::')
    .map((part) => (part ? part.split(':').map((group) => parseInt(group, 16)) : []));
  const zeros = Array<number>(8 - head.length - tail.length).fill(0);
  return [...head, ...zeros, ...tail];
}

function embeddedIpv4(groups: number[]): string | undefined {
  const embeds = ipv4EmbeddingPrefixes.some((prefix) =>
    prefix.every((group, index) => groups[index] === group),
  );
  if (!embeds) return undefined;
  return groups
    .slice(6)
    .flatMap((group) => [group >> 8, group & 0xff])
    .join('.');
}

function isPublicIpv4(ip: string): boolean {
  return !blockedIpv4.check(ip, 'ipv4');
}

function isPublicIpv6(ip: string): boolean {
  const groups = ipv6Groups(ip);
  const ipv4 = embeddedIpv4(groups);
  if (ipv4) return isPublicIpv4(ipv4);
  const isGlobalUnicast = (groups[0]! & 0xe000) === 0x2000;
  return isGlobalUnicast && !blockedIpv6.check(ip, 'ipv6');
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicIpv4(ip);
  if (family === 6 && !ip.includes('%')) return isPublicIpv6(ip);
  return false;
}

export function limitLookups(lookup: LookupAll): LookupAll {
  let running = 0;
  const waiting: (() => void)[] = [];

  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted();
      if (running < maxConcurrentLookups) {
        running += 1;
        resolve();
        return;
      }
      const giveUp = () => {
        waiting.splice(waiting.indexOf(grant), 1);
        reject(signal!.reason);
      };
      const grant = () => {
        signal?.removeEventListener('abort', giveUp);
        resolve();
      };
      waiting.push(grant);
      signal?.addEventListener('abort', giveUp, { once: true });
    });

  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  return async (host, signal) => {
    await acquire(signal);
    try {
      signal?.throwIfAborted();
      return await lookup(host);
    } finally {
      release();
    }
  };
}

const lookupAll = limitLookups(
  async (host) => (await dnsLookup(host, { all: true, verbatim: true })) as Addresses,
);

async function resolveHost(
  host: string,
  lookup: LookupAll,
  signal?: AbortSignal,
): Promise<Addresses> {
  const family = isIP(host);
  if (family === 4 || family === 6) return [{ address: host, family }];
  try {
    return await lookup(host, signal);
  } catch {
    return [];
  }
}

export async function checkWebhookUrl(
  url: string,
  lookup: LookupAll = lookupAll,
  isAllowed: (ip: string) => boolean = isPublicAddress,
  signal?: AbortSignal,
): Promise<{ ok: true; url: URL; addresses: Addresses } | { ok: false; reason: Rejection }> {
  if (url.length > maxUrlLength) return { ok: false, reason: 'too_long' };
  const parsed = URL.parse(url);
  if (!parsed) return { ok: false, reason: 'invalid' };
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'credentials' };

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = await resolveHost(host, lookup, signal);
  if (addresses.length === 0) return { ok: false, reason: 'dns' };
  if (!addresses.every(({ address }) => isAllowed(address))) {
    return { ok: false, reason: 'address' };
  }
  return { ok: true, url: parsed, addresses };
}
