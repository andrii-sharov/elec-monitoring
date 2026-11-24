import { createHash, verify } from 'node:crypto';

export type ReleaseFiles = { app: Uint8Array; factory: Uint8Array; signature: Uint8Array };

export const APP_OFFSET = 0x10000;

function signatureMatches(files: ReleaseFiles, publicKeyPem: string): boolean {
  try {
    return verify('sha256', files.app, { key: publicKeyPem, dsaEncoding: 'der' }, files.signature);
  } catch {
    return false;
  }
}

export function verifyRelease(files: ReleaseFiles, publicKeyPem: string): { sha256: Buffer } {
  if (files.app.length === 0) throw new Error('app.bin is empty');
  if (!signatureMatches(files, publicKeyPem)) {
    throw new Error('app.sig is not a valid signature of app.bin for the OTA public key');
  }
  if (files.factory.length < APP_OFFSET + files.app.length) {
    throw new Error('factory.bin is shorter than app.bin at 0x10000');
  }
  const embedded = files.factory.subarray(APP_OFFSET, APP_OFFSET + files.app.length);
  if (!Buffer.from(embedded).equals(Buffer.from(files.app))) {
    throw new Error('factory.bin does not hold app.bin at 0x10000');
  }
  return { sha256: createHash('sha256').update(files.app).digest() };
}
