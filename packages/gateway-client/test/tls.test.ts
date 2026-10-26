import { rootCertificates } from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTlsConnectOptions, FseConfigError, type FseTlsOptions } from '../src/index.js';
import { testCertificates } from './helpers.js';

function tlsOptions(extra: Partial<FseTlsOptions> = {}): FseTlsOptions {
  const { tls } = testCertificates();
  return { cert: tls.certificatePem, key: tls.privateKeyPem, ...extra };
}

describe('buildTlsConnectOptions', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('always verifies the server certificate and requires TLS 1.2+', () => {
    const options = buildTlsConnectOptions(tlsOptions());
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.minVersion).toBe('TLSv1.2');
    expect(options.ca).toBeUndefined(); // Node.js default roots
  });

  it('refuses an attempt to disable verification', () => {
    const sneaky = { ...tlsOptions(), rejectUnauthorized: false } as FseTlsOptions;
    expect(() => buildTlsConnectOptions(sneaky)).toThrow(FseConfigError);
  });

  it('refuses to run with NODE_TLS_REJECT_UNAUTHORIZED=0', () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    expect(() => buildTlsConnectOptions(tlsOptions())).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });

  it('adds extra CAs to the default roots, or pins them with caOnly', () => {
    const { signature } = testCertificates();
    const added = buildTlsConnectOptions(tlsOptions({ ca: signature.certificatePem }));
    expect(added.ca).toHaveLength(rootCertificates.length + 1);
    const pinned = buildTlsConnectOptions(tlsOptions({ ca: [signature.certificatePem], caOnly: true }));
    expect(pinned.ca).toEqual([signature.certificatePem]);
  });

  it('refuses a client key that does not match the certificate', () => {
    const { tls, signature } = testCertificates();
    expect(() => buildTlsConnectOptions({ cert: tls.certificatePem, key: signature.privateKeyPem })).toThrow(
      /does not match/,
    );
  });
});
