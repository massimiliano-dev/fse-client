import { createPrivateKey } from 'node:crypto';
import { rootCertificates, type ConnectionOptions } from 'node:tls';
import { Agent } from 'undici';
import { FseConfigError } from './errors.js';
import { assertCertificateCurrentlyValid, parseCertificate } from './signer.js';

/**
 * mTLS material for the **authentication** certificate ("certificato di autenticazione", README §2.3):
 * used only as TLS client certificate. JWTs are signed with the separate signature certificate.
 */
export interface FseTlsOptions {
  /** PEM client certificate issued by the FSE CA. */
  cert: string | Buffer;
  /** PEM private key of the client certificate. */
  key: string | Buffer;
  /** Passphrase of an encrypted private key. */
  passphrase?: string;
  /**
   * Extra PEM CA certificates trusted for the **gateway server** certificate, added to the Node.js bundled
   * Mozilla roots (unless `caOnly` is set). TODO(verify): which CA issues the modipa(-val) server
   * certificates; the CAs in it-fse-support `doc/CA_Sogei/` appear to be the client-certificate CAs.
   */
  ca?: string | Buffer | ReadonlyArray<string | Buffer>;
  /** Trust only `ca` (certificate pinning to a private CA). Default false. */
  caOnly?: boolean;
}

/**
 * Builds the TLS options used for every gateway connection. Server certificate verification is always on
 * and cannot be disabled: there is no option for it, an explicit `rejectUnauthorized: false` is refused,
 * and so is a process started with `NODE_TLS_REJECT_UNAUTHORIZED=0`.
 */
export function buildTlsConnectOptions(tls: FseTlsOptions, now: Date = new Date()): ConnectionOptions {
  if ((tls as { rejectUnauthorized?: unknown }).rejectUnauthorized === false) {
    throw new FseConfigError('TLS certificate verification cannot be disabled');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new FseConfigError(
      'NODE_TLS_REJECT_UNAUTHORIZED=0 is set: refusing to send health data with TLS verification disabled',
    );
  }

  const certificate = parseCertificate(tls.cert, 'authentication (TLS client)');
  assertCertificateCurrentlyValid(certificate, now, 'authentication (TLS client)');
  let keyMatches: boolean;
  try {
    const key = createPrivateKey(
      tls.passphrase === undefined
        ? { key: tls.key, format: 'pem' }
        : { key: tls.key, format: 'pem', passphrase: tls.passphrase },
    );
    keyMatches = certificate.checkPrivateKey(key);
  } catch {
    throw new FseConfigError('Cannot read the TLS client private key (wrong format or passphrase)');
  }
  if (!keyMatches)
    throw new FseConfigError('The TLS client private key does not match the client certificate');

  const extraCa =
    tls.ca === undefined ? [] : Array.isArray(tls.ca) ? [...tls.ca] : [tls.ca as string | Buffer];
  if (tls.caOnly && extraCa.length === 0)
    throw new FseConfigError('caOnly requires at least one CA certificate');
  const ca = tls.caOnly ? extraCa : extraCa.length > 0 ? [...rootCertificates, ...extraCa] : undefined;

  return {
    cert: tls.cert,
    key: tls.key,
    ...(tls.passphrase === undefined ? {} : { passphrase: tls.passphrase }),
    ...(ca === undefined ? {} : { ca }),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  };
}

/** Timeouts of the gateway HTTP agent. */
export interface FseAgentTimeouts {
  connectTimeoutMs: number;
  headersTimeoutMs: number;
  bodyTimeoutMs: number;
}

/** Creates the undici `Agent` that carries the client certificate. */
export function createMtlsAgent(connect: ConnectionOptions, timeouts: FseAgentTimeouts): Agent {
  return new Agent({
    connect: { ...connect, rejectUnauthorized: true, timeout: timeouts.connectTimeoutMs },
    headersTimeout: timeouts.headersTimeoutMs,
    bodyTimeout: timeouts.bodyTimeoutMs,
  });
}
