import { generateKeyPairSync } from 'node:crypto';
import { inspect } from 'node:util';
import { createTestCertificate } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it } from 'vitest';
import { FseConfigError, RsaPemJwtSigner } from '../src/index.js';
import { testCertificates } from './helpers.js';

describe('RsaPemJwtSigner', () => {
  it('exposes the certificate CN and never the key', () => {
    const { signature } = testCertificates();
    const signer = RsaPemJwtSigner.fromPem({
      certificatePem: signature.certificatePem,
      privateKeyPem: signature.privateKeyPem,
    });
    expect(signer.certificateCommonName).toBe('SYNTHETIC-SIGN-CN');
    const keyBody = signature.privateKeyPem.split('\n')[1] ?? '';
    expect(inspect(signer, { depth: 10, showHidden: true })).not.toContain(keyBody);
    expect(JSON.stringify(signer)).not.toContain(keyBody);
    expect(inspect(signer)).not.toContain('PRIVATE');
  });

  it('refuses a key that does not match the certificate', () => {
    const { signature, tls } = testCertificates();
    expect(() =>
      RsaPemJwtSigner.fromPem({ certificatePem: signature.certificatePem, privateKeyPem: tls.privateKeyPem }),
    ).toThrow(/does not match/);
  });

  it('refuses expired certificates', () => {
    const old = createTestCertificate({ validFrom: new Date('2020-01-01T00:00:00Z'), validDays: 1 });
    expect(() =>
      RsaPemJwtSigner.fromPem({ certificatePem: old.certificatePem, privateKeyPem: old.privateKeyPem }),
    ).toThrow(/expired/);
  });

  it('refuses non-RSA keys and garbage without echoing them', () => {
    const { signature } = testCertificates();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() =>
      RsaPemJwtSigner.fromPem({ certificatePem: signature.certificatePem, privateKeyPem: ec }),
    ).toThrow(FseConfigError);
    try {
      RsaPemJwtSigner.fromPem({
        certificatePem: 'not a cert SECRET-MARKER',
        privateKeyPem: signature.privateKeyPem,
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRET-MARKER');
    }
  });
});
