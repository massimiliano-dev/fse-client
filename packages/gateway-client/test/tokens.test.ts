import { createPublicKey, createVerify, X509Certificate } from 'node:crypto';
import { makeTestPdf } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it } from 'vitest';
import { createFseTokens, FseConfigError, RsaPemJwtSigner, sha256Hex } from '../src/index.js';
import { application, context, decodeSegment, testCertificates } from './helpers.js';

const AUD = 'https://modipa-val.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1';

function signer() {
  const { signature } = testCertificates();
  return RsaPemJwtSigner.fromPem({
    certificatePem: signature.certificatePem,
    privateKeyPem: signature.privateKeyPem,
  });
}

function verifyRs256(token: string, certificatePem: string): boolean {
  const [h, p, s] = token.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${h}.${p}`);
  return verifier.verify(
    createPublicKey(new X509Certificate(certificatePem).publicKey.export({ type: 'spki', format: 'pem' })),
    Buffer.from(s ?? '', 'base64url'),
  );
}

describe('createFseTokens', () => {
  const pdf = makeTestPdf();
  const now = new Date('2026-10-26T10:00:00Z');

  it('builds both tokens with the claims of README §16.1', async () => {
    const tokens = await createFseTokens({
      signer: signer(),
      audience: AUD,
      application,
      context,
      actionId: 'CREATE',
      defaultPurposeOfUse: 'TREATMENT',
      attachment: pdf,
      now: () => now,
    });
    const iat = Math.floor(now.getTime() / 1000);

    const auth = decodeSegment(tokens.authorization, 1);
    expect(auth).toEqual({
      iss: 'auth:SYNTHETIC-SIGN-CN',
      sub: context.subject,
      aud: AUD,
      iat,
      exp: iat + 300,
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    const sig = decodeSegment(tokens.signature, 1);
    expect(sig).toMatchObject({
      iss: 'integrity:SYNTHETIC-SIGN-CN',
      sub: context.subject,
      aud: AUD,
      iat,
      exp: iat + 300,
      subject_role: 'AAS',
      purpose_of_use: 'TREATMENT',
      action_id: 'CREATE',
      person_id: context.personId,
      locality: context.locality,
      subject_organization_id: '999',
      subject_organization: 'Regione Sintetica',
      patient_consent: true,
      resource_hl7_type: context.resourceHl7Type,
      subject_application_id: application.id,
      subject_application_vendor: application.vendor,
      subject_application_version: application.version,
      attachment_hash: sha256Hex(pdf),
    });
    expect(sig.attachment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.jti).not.toBe(auth.jti);
  });

  it('signs with RS256 and puts the signature certificate in x5c', async () => {
    const { signature } = testCertificates();
    const tokens = await createFseTokens({
      signer: signer(),
      audience: AUD,
      application,
      context,
      actionId: 'CREATE',
      defaultPurposeOfUse: 'TREATMENT',
    });
    for (const token of [tokens.authorization, tokens.signature]) {
      const header = decodeSegment(token, 0);
      expect(header).toEqual({
        alg: 'RS256',
        typ: 'JWT',
        x5c: [new X509Certificate(signature.certificatePem).raw.toString('base64')],
      });
      expect(verifyRs256(token, signature.certificatePem)).toBe(true);
    }
  });

  it('uses a fresh random jti on every call', async () => {
    const input = {
      signer: signer(),
      audience: AUD,
      application,
      context,
      actionId: 'CREATE' as const,
      defaultPurposeOfUse: 'TREATMENT' as const,
    };
    const a = await createFseTokens(input);
    const b = await createFseTokens(input);
    expect(a.authClaims.jti).not.toBe(b.authClaims.jti);
    expect(a.signatureClaims.jti).not.toBe(b.signatureClaims.jti);
  });

  it('refuses lifetimes above 5 minutes', async () => {
    const base = {
      signer: signer(),
      audience: AUD,
      application,
      context,
      actionId: 'CREATE' as const,
      defaultPurposeOfUse: 'TREATMENT' as const,
    };
    await expect(createFseTokens({ ...base, ttlSeconds: 301 })).rejects.toBeInstanceOf(FseConfigError);
    await expect(createFseTokens({ ...base, ttlSeconds: 0 })).rejects.toBeInstanceOf(FseConfigError);
    const short = await createFseTokens({ ...base, ttlSeconds: 60 });
    expect(short.authClaims.exp - short.authClaims.iat).toBe(60);
  });

  it('refuses empty required claims without echoing values', async () => {
    await expect(
      createFseTokens({
        signer: signer(),
        audience: AUD,
        application,
        context: { ...context, locality: ' ' },
        actionId: 'CREATE',
        defaultPurposeOfUse: 'TREATMENT',
      }),
    ).rejects.toThrow(/locality/);
  });
});
