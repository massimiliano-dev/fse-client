import {
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  pbkdf2Sync,
  timingSafeEqual,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { children, integerValue, oidToString, readElement, type DerElement } from './der.js';
import { FsePdfError } from './inject.js';

/**
 * Minimal PKCS#12 (RFC 7292) reader built on `node:crypto`: no third-party code touches the password or the
 * key. Supported: the format written by OpenSSL 3 by default (`openssl pkcs12 -export`): HMAC integrity
 * (SHA-1/SHA-256/SHA-384/SHA-512, RFC 7292 Appendix B key derivation), certificates in `data` or PBES2
 * (PBKDF2 + AES-CBC) `encryptedData`, the private key in a `pkcs8ShroudedKeyBag` (decrypted by OpenSSL
 * through `createPrivateKey`) or a plain `keyBag`. Not supported: legacy RC2/RC4/3DES content encryption
 * (`openssl pkcs12 -legacy`), public-key integrity mode, PBMAC1, BER indefinite lengths. Re-export such files
 * with `openssl pkcs12 -export -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256`.
 */

const OIDS = {
  data: '1.2.840.113549.1.7.1',
  encryptedData: '1.2.840.113549.1.7.6',
  keyBag: '1.2.840.113549.1.12.10.1.1',
  pkcs8ShroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  x509Certificate: '1.2.840.113549.1.9.22.1',
  pbes2: '1.2.840.113549.1.5.13',
  pbkdf2: '1.2.840.113549.1.5.12',
} as const;

const DIGESTS: Record<string, { name: string; u: number; v: number }> = {
  '1.3.14.3.2.26': { name: 'sha1', u: 20, v: 64 },
  '2.16.840.1.101.3.4.2.1': { name: 'sha256', u: 32, v: 64 },
  '2.16.840.1.101.3.4.2.2': { name: 'sha384', u: 48, v: 128 },
  '2.16.840.1.101.3.4.2.3': { name: 'sha512', u: 64, v: 128 },
};

const PRFS: Record<string, string> = {
  '1.2.840.113549.2.7': 'sha1',
  '1.2.840.113549.2.9': 'sha256',
  '1.2.840.113549.2.10': 'sha384',
  '1.2.840.113549.2.11': 'sha512',
};

const CIPHERS: Record<string, { name: string; keyLength: number }> = {
  '2.16.840.1.101.3.4.1.2': { name: 'aes-128-cbc', keyLength: 16 },
  '2.16.840.1.101.3.4.1.22': { name: 'aes-192-cbc', keyLength: 24 },
  '2.16.840.1.101.3.4.1.42': { name: 'aes-256-cbc', keyLength: 32 },
};

/** Upper bound for PBKDF2 / PKCS#12 KDF iterations: refuses files crafted to burn CPU. */
const MAX_ITERATIONS = 1_000_000;

function fail(reason: string): never {
  throw new FsePdfError(`Cannot read the PKCS#12 file: ${reason}`);
}

function need(element: DerElement | undefined, tag: number): DerElement {
  if (!element || element.tag !== tag) fail('unexpected structure');
  return element;
}

/** RFC 7292 Appendix B.2 key derivation (used for the integrity MAC key, ID = 3). */
export function pkcs12Kdf(
  password: string,
  salt: Buffer,
  id: number,
  iterations: number,
  digest: { name: string; u: number; v: number },
  length: number,
): Buffer {
  const { name, u, v } = digest;
  // BMPString, big-endian UTF-16, with a two-byte NUL terminator.
  const utf16 = Buffer.from(`${password}\0`, 'utf16le');
  const bmp = Buffer.alloc(utf16.length);
  for (let i = 0; i < utf16.length; i += 2) {
    bmp[i] = utf16[i + 1] ?? 0;
    bmp[i + 1] = utf16[i] ?? 0;
  }
  const fill = (src: Buffer) => {
    if (src.length === 0) return Buffer.alloc(0);
    const out = Buffer.alloc(v * Math.ceil(src.length / v));
    for (let i = 0; i < out.length; i++) out[i] = src[i % src.length] ?? 0;
    return out;
  };
  const D = Buffer.alloc(v, id);
  const I = Buffer.concat([fill(salt), fill(bmp)]);
  const result: Buffer[] = [];
  for (let produced = 0; produced < length; produced += u) {
    let A = createHash(name).update(D).update(I).digest();
    for (let r = 1; r < iterations; r++) A = createHash(name).update(A).digest();
    result.push(A);
    const B = fill(A).subarray(0, v);
    for (let j = 0; j < I.length; j += v) {
      // I_j = (I_j + B + 1) mod 2^(8v)
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = (I[j + k] ?? 0) + (B[k] ?? 0) + carry;
        I[j + k] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return Buffer.concat(result).subarray(0, length);
}

function verifyMac(macData: DerElement, authSafe: Buffer, password: string): void {
  const [digestInfo, saltEl, iterEl] = children(macData);
  const [algorithm, digestEl] = children(need(digestInfo, 0x30));
  const digest = DIGESTS[oidToString(need(children(need(algorithm, 0x30))[0], 0x06))];
  if (!digest) fail('unsupported MAC algorithm');
  const iterations = iterEl ? integerValue(iterEl) : 1;
  if (iterations < 1 || iterations > MAX_ITERATIONS) fail('unsupported MAC iteration count');
  const key = pkcs12Kdf(password, need(saltEl, 0x04).content, 3, iterations, digest, digest.u);
  const mac = createHmac(digest.name, key).update(authSafe).digest();
  const expected = need(digestEl, 0x04).content;
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    fail('integrity check failed (wrong password or corrupted file)');
  }
}

/** ContentInfo { contentType, [0] EXPLICIT content } → the OCTET STRING content of a `data` ContentInfo. */
function dataContent(contentInfo: DerElement): Buffer {
  const [type, explicit] = children(need(contentInfo, 0x30));
  if (oidToString(need(type, 0x06)) !== OIDS.data) fail('unexpected content type');
  return need(children(need(explicit, 0xa0))[0], 0x04).content;
}

function decryptPbes2(algorithm: DerElement, encrypted: Buffer, password: string): Buffer {
  const [oid, params] = children(need(algorithm, 0x30));
  if (oidToString(need(oid, 0x06)) !== OIDS.pbes2) {
    fail('legacy encryption is not supported: re-export with -certpbe AES-256-CBC -keypbe AES-256-CBC');
  }
  const [kdf, scheme] = children(need(params, 0x30));
  const [kdfOid, kdfParams] = children(need(kdf, 0x30));
  if (oidToString(need(kdfOid, 0x06)) !== OIDS.pbkdf2) fail('unsupported key derivation');
  const kdfFields = children(need(kdfParams, 0x30));
  const salt = need(kdfFields[0], 0x04).content;
  const iterations = integerValue(need(kdfFields[1], 0x02));
  if (iterations < 1 || iterations > MAX_ITERATIONS) fail('unsupported PBKDF2 iteration count');
  const prfField = kdfFields.slice(2).find((f) => f.tag === 0x30);
  const prf = prfField ? PRFS[oidToString(need(children(prfField)[0], 0x06))] : 'sha1';
  if (!prf) fail('unsupported PBKDF2 PRF');
  const [cipherOid, iv] = children(need(scheme, 0x30));
  const cipher = CIPHERS[oidToString(need(cipherOid, 0x06))];
  if (!cipher) fail('unsupported cipher');
  const key = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, cipher.keyLength, prf);
  try {
    const decipher = createDecipheriv(cipher.name, key, need(iv, 0x04).content);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    return fail('decryption failed (wrong password or corrupted file)');
  }
}

/** EncryptedData { version, EncryptedContentInfo { contentType, algorithm, [0] IMPLICIT content } }. */
function encryptedContent(contentInfo: DerElement, password: string): Buffer {
  const [, explicit] = children(contentInfo);
  const encryptedData = need(children(need(explicit, 0xa0))[0], 0x30);
  const [, eci] = children(encryptedData);
  const [, algorithm, content] = children(need(eci, 0x30));
  if (!content || (content.tag !== 0x80 && content.tag !== 0xa0)) fail('no encrypted content');
  const bytes =
    content.tag === 0x80
      ? content.content
      : Buffer.concat(children(content).map((c) => need(c, 0x04).content));
  return decryptPbes2(need(algorithm, 0x30), bytes, password);
}

/** The private key and certificates of a PKCS#12 file. */
export interface Pkcs12Contents {
  key: KeyObject;
  certificates: X509Certificate[];
}

/** Reads a PKCS#12 file. Errors never contain the password or key material. */
export function readPkcs12(file: Uint8Array, password: string): Pkcs12Contents {
  let pfx: DerElement & { end: number };
  try {
    pfx = readElement(Buffer.from(file));
  } catch {
    return fail('not a DER PKCS#12 file');
  }
  if (pfx.tag !== 0x30 || pfx.end !== file.byteLength) fail('not a DER PKCS#12 file');
  try {
    const [version, authSafeInfo, macData] = children(pfx);
    if (integerValue(need(version, 0x02)) !== 3) fail('unsupported version');
    const authSafe = dataContent(need(authSafeInfo, 0x30));
    if (!macData) fail('no integrity MAC (public-key integrity mode is not supported)');
    verifyMac(need(macData, 0x30), authSafe, password);

    const keys: KeyObject[] = [];
    const certificates: X509Certificate[] = [];
    for (const contentInfo of children(readElement(authSafe))) {
      const type = oidToString(need(children(contentInfo)[0], 0x06));
      const safeContents =
        type === OIDS.data
          ? dataContent(contentInfo)
          : type === OIDS.encryptedData
            ? encryptedContent(contentInfo, password)
            : fail('unsupported content type');
      for (const bag of children(readElement(safeContents))) {
        const [bagId, bagValue] = children(need(bag, 0x30));
        const value = need(children(need(bagValue, 0xa0))[0], 0x30);
        const id = oidToString(need(bagId, 0x06));
        if (id === OIDS.pkcs8ShroudedKeyBag || id === OIDS.keyBag) {
          try {
            keys.push(
              id === OIDS.keyBag
                ? createPrivateKey({ key: value.raw, format: 'der', type: 'pkcs8' })
                : createPrivateKey({ key: value.raw, format: 'der', type: 'pkcs8', passphrase: password }),
            );
          } catch {
            fail('cannot decrypt the private key (wrong password or legacy encryption)');
          }
        } else if (id === OIDS.certBag) {
          const [certType, certValue] = children(value);
          if (oidToString(need(certType, 0x06)) !== OIDS.x509Certificate) continue;
          certificates.push(new X509Certificate(need(children(need(certValue, 0xa0))[0], 0x04).content));
        }
      }
    }
    if (keys.length !== 1) fail('expected exactly one private key');
    return { key: keys[0]!, certificates };
  } catch (error) {
    if (error instanceof FsePdfError) throw error;
    return fail('unexpected structure');
  }
}
