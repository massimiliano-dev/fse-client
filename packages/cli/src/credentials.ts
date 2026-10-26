import {
  buildTlsConnectOptions,
  RsaPemJwtSigner,
  type FseTlsOptions,
} from '@massimiliano-dev/fse-gateway-client';
import { CliError, readLimitedFile, readSecretFile } from './files.js';
import type { CliIo } from './io.js';

/**
 * Credentials come ONLY from environment variables that point to files (never from command-line flags,
 * which end up in shell history and in `ps` output). Passphrases come from environment variables.
 */
export const CREDENTIAL_ENV = {
  signCert: 'FSE_SIGN_CERT_FILE',
  signKey: 'FSE_SIGN_KEY_FILE',
  signKeyPassphrase: 'FSE_SIGN_KEY_PASSPHRASE',
  tlsCert: 'FSE_TLS_CERT_FILE',
  tlsKey: 'FSE_TLS_KEY_FILE',
  tlsKeyPassphrase: 'FSE_TLS_KEY_PASSPHRASE',
  tlsCa: 'FSE_TLS_CA_FILE',
} as const;

function required(io: CliIo, name: string): string {
  const value = io.env[name];
  if (!value) throw new CliError(`Environment variable ${name} is required (path to a PEM file)`);
  return value;
}

/** Loads the JWT signer from `FSE_SIGN_CERT_FILE` / `FSE_SIGN_KEY_FILE` / `FSE_SIGN_KEY_PASSPHRASE`. */
export async function loadSigner(io: CliIo): Promise<RsaPemJwtSigner> {
  const certificatePem = await readLimitedFile(
    io.cwd,
    required(io, CREDENTIAL_ENV.signCert),
    64 * 1024,
    'Signature certificate',
  );
  const privateKeyPem = await readSecretFile(
    io.cwd,
    required(io, CREDENTIAL_ENV.signKey),
    'Signature private key',
    io.stderr,
  );
  const passphrase = io.env[CREDENTIAL_ENV.signKeyPassphrase];
  return RsaPemJwtSigner.fromPem({
    certificatePem,
    privateKeyPem,
    ...(passphrase ? { passphrase } : {}),
  });
}

/** Loads the mTLS options from `FSE_TLS_*`, or returns undefined when not configured. */
export async function loadTls(io: CliIo): Promise<FseTlsOptions | undefined> {
  const certPath = io.env[CREDENTIAL_ENV.tlsCert];
  const keyPath = io.env[CREDENTIAL_ENV.tlsKey];
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) {
    throw new CliError(`Set both ${CREDENTIAL_ENV.tlsCert} and ${CREDENTIAL_ENV.tlsKey}`);
  }
  const caPath = io.env[CREDENTIAL_ENV.tlsCa];
  const passphrase = io.env[CREDENTIAL_ENV.tlsKeyPassphrase];
  const tls: FseTlsOptions = {
    cert: await readLimitedFile(io.cwd, certPath, 64 * 1024, 'TLS client certificate'),
    key: await readSecretFile(io.cwd, keyPath, 'TLS client private key', io.stderr),
    ...(passphrase ? { passphrase } : {}),
    ...(caPath ? { ca: await readLimitedFile(io.cwd, caPath, 1024 * 1024, 'CA bundle') } : {}),
  };
  buildTlsConnectOptions(tls); // validates certificate, key match and expiry
  return tls;
}
