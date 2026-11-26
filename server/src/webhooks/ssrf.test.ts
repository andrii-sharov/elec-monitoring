import { lookup as dnsLookup } from 'node:dns/promises';
import { describe, expect, test, vi } from 'vitest';
import { checkWebhookUrl, isPublicAddress, limitLookups, type LookupAll } from './ssrf.ts';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn<() => Promise<Address[]>>(async () => [{ address: '1.2.3.4', family: 4 }]),
}));

type Address = Awaited<ReturnType<LookupAll>>[number];

const v4 = (address: string): Address => ({ address, family: 4 });
const v6 = (address: string): Address => ({ address, family: 6 });
const resolvesTo = (...addresses: Address[]) => vi.fn<LookupAll>(async () => addresses);
const onlyLoopback = (ip: string) => ip === '127.0.0.1';

describe('isPublicAddress', () => {
  test.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.1.2.3',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254',
    '172.16.0.0',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.0.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks IPv4 %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  test.each([
    '::',
    '::1',
    '::7f00:1',
    '100::1',
    '1fff::1',
    '4000::1',
    '5f00::1',
    'fe80::1',
    'fec0::1',
    'fc00::1',
    'fd12::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:FFFF:10.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:0:8.8.8.8',
    '64:ff9b::a00:1',
    '64:ff9b::127.0.0.1',
    '64:ff9b::',
    '64:ff9b:1::808:808',
    '2001:db8::1',
    '2001:0DB8:ffff::1',
    '2002::1',
    '2002:7f00:1::1',
    '2001::1',
    '2001:0:ffff::1',
  ])('blocks IPv6 %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  test.each([
    '1.1.1.1',
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '198.20.0.1',
    '223.255.255.255',
    '2000::1',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
    '3ffe::1',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
    '64:ff9b::8.8.8.8',
  ])('allows %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  test.each([
    '',
    'example.com',
    'localhost',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '127.000.000.001',
    '0x7f.0.0.1',
    '2130706433',
    ' 1.1.1.1',
    '1.1.1.1\n',
    '1.1.1.1/32',
    '[2606:4700:4700::1111]',
    '2606:4700:4700::1111%en0',
    'fe80::1%en0',
    '2606:::1',
  ])('rejects the non-address %j', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('checkWebhookUrl', () => {
  test.each([
    ['http://example.com', 'scheme'],
    ['ftp://example.com', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['https://u:p@example.com', 'credentials'],
    ['https://u@example.com', 'credentials'],
    ['https://:p@example.com', 'credentials'],
    ['', 'invalid'],
    ['example.com/hook', 'invalid'],
    ['https://', 'invalid'],
    ['https://exa mple.com', 'invalid'],
    ['https://example.com:70000', 'invalid'],
    [`https://example.com/${'a'.repeat(2029)}`, 'too_long'],
  ])('rejects %j as %s without a lookup', async (url, reason) => {
    const lookup = resolvesTo(v4('1.2.3.4'));
    expect(await checkWebhookUrl(url, lookup)).toEqual({ ok: false, reason });
    expect(lookup).not.toHaveBeenCalled();
  });

  test.each([
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[64:ff9b::10.0.0.1]/',
    'https://[fd12::1]:8443/hook',
    'https://127.0.0.1/',
    'https://127.1/',
    'https://127.0.0.1./',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0177.0.0.1/',
    'https://%31%32%37.0.0.1/',
    'https://１２７.０.０.１/',
    'https://169.254.169.254/latest/meta-data',
  ])('rejects the literal %s without a lookup', async (url) => {
    const lookup = resolvesTo(v4('1.2.3.4'));
    expect(await checkWebhookUrl(url, lookup)).toEqual({ ok: false, reason: 'address' });
    expect(lookup).not.toHaveBeenCalled();
  });

  test.each([
    ['one private address among public ones', [v4('1.2.3.4'), v4('10.0.0.1')]],
    ['a private first address', [v4('10.0.0.1'), v4('1.2.3.4')]],
    ['a private IPv6 beside a public IPv4', [v4('1.2.3.4'), v6('::1')]],
    ['a mapped loopback', [v6('::ffff:127.0.0.1')]],
    ['a zoned link-local', [v6('fe80::1%en0')]],
    ['something that is not an address', [v4('example.com')]],
  ])('rejects a host resolving to %s', async (_, addresses) => {
    const result = await checkWebhookUrl('https://example.com/', resolvesTo(...addresses));
    expect(result).toEqual({ ok: false, reason: 'address' });
  });

  test('reports a failed lookup as dns', async () => {
    const lookup = vi.fn<LookupAll>().mockRejectedValue(new Error('ENOTFOUND'));
    expect(await checkWebhookUrl('https://example.com/', lookup)).toEqual({
      ok: false,
      reason: 'dns',
    });
  });

  test('reports an empty lookup result as dns', async () => {
    expect(await checkWebhookUrl('https://example.com/', resolvesTo())).toEqual({
      ok: false,
      reason: 'dns',
    });
  });

  test('accepts any port and returns the checked addresses', async () => {
    const addresses = [v4('1.2.3.4'), v6('2606:4700:4700::1111')];
    const lookup = resolvesTo(...addresses);
    expect(await checkWebhookUrl('https://example.com:8123/hook', lookup)).toEqual({
      ok: true,
      url: new URL('https://example.com:8123/hook'),
      addresses,
    });
    expect(lookup).toHaveBeenCalledExactlyOnceWith('example.com', undefined);
  });

  test.each([
    ['https://1.1.1.1/hook', v4('1.1.1.1')],
    ['https://[2606:4700:4700::1111]/hook', v6('2606:4700:4700::1111')],
  ])('accepts the public literal %s without a lookup', async (url, address) => {
    const lookup = resolvesTo(v4('10.0.0.1'));
    expect(await checkWebhookUrl(url, lookup)).toEqual({
      ok: true,
      url: new URL(url),
      addresses: [address],
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  test('accepts a URL of exactly 2048 characters', async () => {
    const url = `https://example.com/${'a'.repeat(2028)}`;
    expect(url).toHaveLength(2048);
    expect(await checkWebhookUrl(url, resolvesTo(v4('1.2.3.4')))).toMatchObject({ ok: true });
  });

  test('uses an injected address check for literals and resolved hosts', async () => {
    const lookup = resolvesTo(v4('127.0.0.1'));
    expect(await checkWebhookUrl('https://127.0.0.1/', lookup, onlyLoopback)).toMatchObject({
      ok: true,
    });
    expect(await checkWebhookUrl('https://example.com/', lookup, onlyLoopback)).toMatchObject({
      ok: true,
    });
    expect(await checkWebhookUrl('https://1.1.1.1/', lookup, onlyLoopback)).toEqual({
      ok: false,
      reason: 'address',
    });
  });

  test('resolves every address in resolver order by default', async () => {
    expect(await checkWebhookUrl('https://example.com/')).toMatchObject({
      ok: true,
      addresses: [v4('1.2.3.4')],
    });
    expect(dnsLookup).toHaveBeenCalledExactlyOnceWith('example.com', {
      all: true,
      verbatim: true,
    });
  });
});

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function heldLookup() {
  const held: PromiseWithResolvers<Address[]>[] = [];
  const hosts: string[] = [];
  const lookup = (host: string) => {
    hosts.push(host);
    const pending = Promise.withResolvers<Address[]>();
    held.push(pending);
    return pending.promise;
  };
  const answer = (index: number) => held[index]!.resolve([v4('1.2.3.4')]);
  return { lookup, hosts, held, answer };
}

describe('limitLookups', () => {
  test('runs two lookups at once and starts the next when one settles', async () => {
    const { lookup, hosts, held, answer } = heldLookup();
    const limited = limitLookups(lookup);
    const first = limited('a.test');
    const second = limited('b.test').catch(() => 'failed');
    const third = limited('c.test');
    const fourth = limited('d.test');
    await nextTurn();
    expect(hosts).toEqual(['a.test', 'b.test']);

    answer(0);
    await first;
    await nextTurn();
    expect(hosts).toEqual(['a.test', 'b.test', 'c.test']);

    held[1]!.reject(new Error('ENOTFOUND'));
    expect(await second).toBe('failed');
    await nextTurn();
    expect(hosts).toEqual(['a.test', 'b.test', 'c.test', 'd.test']);

    answer(2);
    answer(3);
    expect(await Promise.all([third, fourth])).toHaveLength(2);
  });

  test('never starts a lookup for a caller that gave up while waiting', async () => {
    const { lookup, hosts, answer } = heldLookup();
    const limited = limitLookups(lookup);
    void limited('a.test');
    void limited('b.test');
    const controller = new AbortController();
    const abandoned = limited('c.test', controller.signal);
    const next = limited('d.test');
    controller.abort(new Error('gave up'));
    await expect(abandoned).rejects.toThrow('gave up');

    answer(0);
    await nextTurn();
    expect(hosts).toEqual(['a.test', 'b.test', 'd.test']);
    answer(2);
    await next;
  });

  test('does not start a lookup for an already aborted caller', async () => {
    const { lookup, hosts } = heldLookup();
    const aborted = AbortSignal.abort(new Error('gave up'));
    await expect(limitLookups(lookup)('a.test', aborted)).rejects.toThrow('gave up');
    expect(hosts).toEqual([]);
  });

  test('keeps the slot of an abandoned lookup until it settles', async () => {
    const { lookup, hosts, answer } = heldLookup();
    const limited = limitLookups(lookup);
    const controller = new AbortController();
    const first = limited('a.test', controller.signal);
    void limited('b.test');
    await nextTurn();
    controller.abort();
    const third = limited('c.test');
    await nextTurn();
    expect(hosts).toEqual(['a.test', 'b.test']);

    answer(0);
    await first;
    await nextTurn();
    expect(hosts).toEqual(['a.test', 'b.test', 'c.test']);
    answer(2);
    await third;
  });

  test('limits the default DNS lookup across callers', async () => {
    const release = Promise.withResolvers<void>();
    vi.mocked(dnsLookup).mockClear();
    vi.mocked(dnsLookup).mockImplementation((async () => {
      await release.promise;
      return [v4('1.2.3.4')];
    }) as unknown as typeof dnsLookup);

    const checks = ['a', 'b', 'c', 'd'].map((name) => checkWebhookUrl(`https://${name}.test/`));
    await nextTurn();
    expect(dnsLookup).toHaveBeenCalledTimes(2);

    release.resolve();
    expect((await Promise.all(checks)).map((result) => result.ok)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(dnsLookup).toHaveBeenCalledTimes(4);
  });
});
