import { createPrivateKey, sign as cryptoSign, X509Certificate, type KeyObject } from 'node:crypto';
import { inspect } from 'node:util';
import { FseConfigError } from './errors.js';

/** JWS algorithms accepted by the gateway (README §16.1: "RS256, RS383 [sic], RS512"). */
export type FseJwtAlgorithm = 'RS256' | 'RS384' | 'RS512';

/**
 * Signs FSE JWT payloads with the **signature** certificate's private key.
 *
 * Implement it to sign with an HSM, a cloud KMS or a remote signing service: the private key then never
 * needs to be in the application's memory. The returned token must be a compact JWS whose header contains
 * `alg`, `typ: "JWT"` and `x5c` (the signature certificate, base64 DER), as required by README §16.1.
 */
export interface FseJwtSigner {
  /** Common Name of the signature certificate, used to build `iss` (`auth:<CN>` / `integrity:<CN>`). */
  readonly certificateCommonName: string;
  /** Signs the claims and returns a compact JWS (`header.payload.signature`). */
  sign(claims: Readonly<Record<string, unknown>>): Promise<string>;
}

/** Options of {@link RsaPemJwtSigner.fromPem}. */
export interface RsaPemJwtSignerOptions {
  /** PEM private key of the signature certificate (PKCS#8 or PKCS#1, optionally encrypted). */
  privateKeyPem: string | Buffer;
  /** Passphrase of an encrypted private key. Read it from a secret store, never from the command line. */
  passphrase?: string;
  /** PEM signature certificate issued by the FSE CA. */
  certificatePem: string | Buffer;
  /** Default `RS256`. */
  algorithm?: FseJwtAlgorithm;
  /** Clock used for the certificate validity check (tests). */
  now?: () => Date;
}

const HASH: Record<FseJwtAlgorithm, string> = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512' };

/**
 * {@link FseJwtSigner} backed by `node:crypto` with an RSA key held in memory as a non-exportable-by-default
 * `KeyObject`. The key and the PEM input are never logged: `util.inspect` and `JSON.stringify` show only
 * the certificate CN.
 */
export class RsaPemJwtSigner implements FseJwtSigner {
  readonly #key: KeyObject;
  readonly #x5c: string;
  readonly #algorithm: FseJwtAlgorithm;
  readonly certificateCommonName: string;

  private constructor(key: KeyObject, certificate: X509Certificate, algorithm: FseJwtAlgorithm) {
    this.#key = key;
    this.#x5c = certificate.raw.toString('base64');
    this.#algorithm = algorithm;
    this.certificateCommonName = commonNameOf(certificate);
  }

  /**
   * Loads and checks the key and certificate: RSA ≥ 2048 bits, certificate currently valid, key matching
   * the certificate.
   *
   * @throws {FseConfigError} with a message that never contains key material.
   */
  static fromPem(options: RsaPemJwtSignerOptions): RsaPemJwtSigner {
    const algorithm = options.algorithm ?? 'RS256';
    if (!Object.hasOwn(HASH, algorithm))
      throw new FseConfigError(`Unsupported JWT algorithm ${String(algorithm)}`);

    let key: KeyObject;
    try {
      key = createPrivateKey(
        options.passphrase === undefined
          ? { key: options.privateKeyPem, format: 'pem' }
          : { key: options.privateKeyPem, format: 'pem', passphrase: options.passphrase },
      );
    } catch {
      throw new FseConfigError('Cannot read the signature private key (wrong format or passphrase)');
    }
    if (key.asymmetricKeyType !== 'rsa')
      throw new FseConfigError('The signature private key must be an RSA key');
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < 2048) throw new FseConfigError('The signature private key must be at least 2048 bits');

    const certificate = parseCertificate(options.certificatePem, 'signature');
    assertCertificateCurrentlyValid(certificate, (options.now ?? (() => new Date()))(), 'signature');
    if (!certificate.checkPrivateKey(key)) {
      throw new FseConfigError('The signature private key does not match the signature certificate');
    }
    return new RsaPemJwtSigner(key, certificate, algorithm);
  }

  async sign(claims: Readonly<Record<string, unknown>>): Promise<string> {
    const header = { alg: this.#algorithm, typ: 'JWT', x5c: [this.#x5c] };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = cryptoSign(HASH[this.#algorithm], Buffer.from(signingInput, 'ascii'), this.#key);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  toJSON(): Record<string, unknown> {
    return { type: 'RsaPemJwtSigner', certificateCommonName: this.certificateCommonName };
  }

  [inspect.custom](): string {
    return `RsaPemJwtSigner { certificateCommonName: ${JSON.stringify(this.certificateCommonName)} }`;
  }
}

function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

/** Parses a PEM certificate; the error never echoes the input. */
export function parseCertificate(pem: string | Buffer, label: string): X509Certificate {
  try {
    return new X509Certificate(pem);
  } catch {
    throw new FseConfigError(`Cannot parse the ${label} certificate (expected PEM X.509)`);
  }
}

/** Throws if `now` is outside the certificate validity period. */
export function assertCertificateCurrentlyValid(
  certificate: X509Certificate,
  now: Date,
  label: string,
): void {
  const from = new Date(certificate.validFrom);
  const to = new Date(certificate.validTo);
  if (now < from) throw new FseConfigError(`The ${label} certificate is not valid yet`);
  if (now > to) throw new FseConfigError(`The ${label} certificate has expired`);
}

/** Extracts the subject CN (`CN=...`) of a certificate. */
export function commonNameOf(certificate: X509Certificate): string {
  const cn = certificate.subject
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('CN='));
  if (!cn || cn.length <= 3) throw new FseConfigError('The signature certificate has no subject Common Name');
  return cn.slice(3);
}
