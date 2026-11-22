import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { testApp } from '../../test/app.ts';
import { listen } from './listen.ts';

test('resolves with the server once listening', async () => {
  const server = await listen(testApp(), 0);
  try {
    expect(server.listening).toBe(true);
  } finally {
    server.close();
  }
});

test('rejects when the port is taken', async () => {
  const first = await listen(testApp(), 0);
  try {
    const { port } = first.address() as AddressInfo;
    await expect(listen(testApp(), port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  } finally {
    first.close();
  }
});
