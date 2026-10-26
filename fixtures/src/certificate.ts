import { createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** A throwaway key pair and self-signed certificate, PEM encoded. Lives only in memory. */
export interface TestCertificate {
  certificatePem: string;
  privateKeyPem: string;
  privateKey: KeyObject;
  commonName: string;
}

/**
 * Generates an RSA-2048 key and a self-signed X.509 v1 certificate (SHA-256 with RSA) **in memory**.
 *
 * Node.js can parse but not create certificates, so this hand-encodes the minimal DER structure. It is
 * for tests only: there are no extensions, and it must never be used outside the test suite.
 */
export function createTestCertificate(
  options: { commonName?: string; validFrom?: Date; validDays?: number } = {},
): TestCertificate {
  const commonName = options.commonName ?? 'SYNTHETIC-TEST-CERT';
  const notBefore = options.validFrom ?? new Date(Date.now() - 60_000);
  const notAfter = new Date(notBefore.getTime() + (options.validDays ?? 1) * 86_400_000);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const sha256WithRsa = seq(oid([1, 2, 840, 113549, 1, 1, 11]), nul());
  const name = seq(set(seq(oid([2, 5, 4, 3]), utf8(commonName))));
  const serial = randomBytes(8);
  serial[0] = (serial[0] ?? 0) & 0x7f; // positive INTEGER
  const tbs = seq(
    tlv(0x02, serial),
    sha256WithRsa,
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = seq(tbs, sha256WithRsa, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));

  const label = 'CERTIFICATE';
  const body = der
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trimEnd();
  const certificatePem = `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { certificatePem, privateKeyPem, privateKey: createPrivateKey(privateKeyPem), commonName };
}

function tlv(tag: number, value: Buffer): Buffer {
  const len = value.length;
  let header: Buffer;
  if (len < 0x80) header = Buffer.from([tag, len]);
  else if (len < 0x100) header = Buffer.from([tag, 0x81, len]);
  else header = Buffer.from([tag, 0x82, len >> 8, len & 0xff]);
  return Buffer.concat([header, value]);
}
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const nul = () => Buffer.from([0x05, 0x00]);
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));

function oid(parts: number[]): Buffer {
  const [a = 0, b = 0, ...rest] = parts;
  const bytes = [40 * a + b];
  for (const part of rest) {
    const stack = [part & 0x7f];
    let n = part >>> 7;
    while (n > 0) {
      stack.unshift((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(...stack);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(
    date.getUTCHours(),
  )}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, 'ascii'));
}
