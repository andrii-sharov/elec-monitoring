import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { APP_OFFSET, type ReleaseFiles } from '../src/firmware/verify.ts';

export { APP_OFFSET } from '../src/firmware/verify.ts';

export function testKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKeyPem: privateKey.export({ type: 'sec1', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function factoryImage(app: Uint8Array): Uint8Array {
  const factory = new Uint8Array(APP_OFFSET + app.length);
  factory.fill(0xff, 0, APP_OFFSET);
  factory.set(app, APP_OFFSET);
  return factory;
}

export function signedRelease(
  privateKeyPem: string,
  app: Uint8Array = randomBytes(4096),
): ReleaseFiles {
  return {
    app,
    factory: factoryImage(app),
    signature: sign('sha256', app, { key: privateKeyPem, dsaEncoding: 'der' }),
  };
}
