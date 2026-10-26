import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign as cryptoSign, verify, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { createTestCertificate, makeTestPdf, readSyntheticCda } from '@massimiliano-dev/fse-fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CADES_OIDS,
  extractCda,
  FsePdfError,
  injectCda,
  isPdfSigned,
  P12PadesSigner,
  RawSignaturePadesSigner,
  readPkcs12,
} from '../src/index.js';
import { children, readElement, type DerElement } from '../src/der.js';

const cert = createTestCertificate({ commonName: 'SYNTHETIC-PADES-CN' });
const cda = readSyntheticCda();
const tmp = mkdtempSync(join(tmpdir(), 'fse-pades-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const openssl = hasOpenssl();

function oidOf(element: DerElement): string {
  const bytes = [...element.content];
  const first = bytes.shift() ?? 0;
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (const b of bytes) {
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/** Splits a signed PDF into the signed bytes and the CMS, and decodes what PAdES requires. */
function inspectSignature(pdf: Uint8Array) {
  const buf = Buffer.from(pdf);
  const text = buf.toString('latin1');
  const match = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(text);
  expect(match).not.toBeNull();
  const [a, b, c, d] = match!.slice(1).map(Number) as [number, number, number, number];
  expect(a).toBe(0);
  expect(c + d).toBe(buf.length); // the byte ranges cover the whole file except /Contents
  const signedBytes = Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]);
  const hex = buf.subarray(b + 1, c - 1).toString('latin1');
  const cms = Buffer.from(hex, 'hex');
  const contentInfo = readElement(cms);
  const der = contentInfo.raw;

  const [type, explicit] = children(contentInfo);
  expect(oidOf(type!)).toBe(CADES_OIDS.signedData);
  const signedData = children(explicit!)[0]!;
  const sd = children(signedData);
  const signerInfo = children(sd[sd.length - 1]!)[0]!;
  const si = children(signerInfo);
  const signedAttrs = si.find((e) => e.tag === 0xa0)!;
  const signature = si[si.length - 1]!.content;
  const attrs = children(signedAttrs).map((attr) => {
    const [attrType, values] = children(attr);
    return { oid: oidOf(attrType!), value: children(values!)[0]! };
  });
  // What was signed is the attributes encoded as a SET (tag 0x31), RFC 5652 §5.4.
  const signedAttrsAsSet = Buffer.concat([Buffer.from([0x31]), signedAttrs.raw.subarray(1)]);
  return { text, signedBytes, der, attrs, signedAttrsAsSet, signature };
}

function checkPadesBaselineB(pdf: Uint8Array, certificate: X509Certificate) {
  const sig = inspectSignature(pdf);
  expect(sig.text).toContain('/SubFilter /ETSI.CAdES.detached');
  expect(sig.text).toMatch(/\/M \(D:\d{14}/); // claimed signing time in the signature dictionary
  expect(sig.attrs.map((a) => a.oid).sort()).toEqual(
    [CADES_OIDS.contentType, CADES_OIDS.messageDigest, CADES_OIDS.signingCertificateV2].sort(),
  );
  expect(sig.attrs.some((a) => a.oid === CADES_OIDS.signingTime)).toBe(false);
  const digest = sig.attrs.find((a) => a.oid === CADES_OIDS.messageDigest)!.value.content;
  expect(digest.equals(createHash('sha256').update(sig.signedBytes).digest())).toBe(true);
  // signing-certificate-v2 → certs[0] → certHash
  const v2 = sig.attrs.find((a) => a.oid === CADES_OIDS.signingCertificateV2)!.value;
  const essCertIdV2 = children(children(v2)[0]!)[0]!;
  const certHash = children(essCertIdV2)[0]!;
  expect(certHash.tag).toBe(0x04); // hashAlgorithm omitted: SHA-256 is the DEFAULT
  expect(certHash.content.equals(createHash('sha256').update(certificate.raw).digest())).toBe(true);
  expect(verify('sha256', sig.signedAttrsAsSet, certificate.publicKey, sig.signature)).toBe(true);
  return sig;
}

describe('P12PadesSigner (PAdES baseline B-B)', () => {
  it('signs a PDF with the CDA attached and keeps the attachment', async () => {
    const signer = P12PadesSigner.fromPem({
      privateKeyPem: cert.privateKeyPem,
      certificatePem: cert.certificatePem,
    });
    const signed = await signer.sign(await injectCda(makeTestPdf(), cda));
    expect(Buffer.from(signed.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    checkPadesBaselineB(signed, new X509Certificate(cert.certificatePem));
    expect(await extractCda(signed)).toBe(cda);
    expect(await isPdfSigned(signed)).toBe(true);
    await expect(signer.sign(signed)).rejects.toThrow(/already signed/);
    await expect(injectCda(signed, cda)).rejects.toBeInstanceOf(FsePdfError);
  });

  it.skipIf(!openssl)('produces a CMS that OpenSSL verifies independently', async () => {
    const signer = P12PadesSigner.fromPem({
      privateKeyPem: cert.privateKeyPem,
      certificatePem: cert.certificatePem,
    });
    const sig = inspectSignature(await signer.sign(await injectCda(makeTestPdf(), cda)));
    writeFileSync(join(tmp, 'sig.der'), sig.der);
    writeFileSync(join(tmp, 'content.bin'), sig.signedBytes);
    const out = execFileSync(
      'openssl',
      [
        'cms',
        '-verify',
        '-binary',
        '-inform',
        'DER',
        '-in',
        join(tmp, 'sig.der'),
        '-content',
        join(tmp, 'content.bin'),
        '-noverify',
        '-out',
        join(tmp, 'out.bin'),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).toBeDefined();
    expect(readFileSync(join(tmp, 'out.bin')).equals(sig.signedBytes)).toBe(true);
    const printed = execFileSync('openssl', [
      'cms',
      '-cmsout',
      '-print',
      '-inform',
      'DER',
      '-in',
      join(tmp, 'sig.der'),
    ]).toString();
    expect(printed).toContain('id-smime-aa-signingCertificateV2');
    expect(printed).not.toContain('signingTime');
  });

  describe.skipIf(!openssl)('PKCS#12 (built-in node:crypto reader)', () => {
    const key = join(tmp, 'k.pem');
    const crt = join(tmp, 'c.pem');
    const ca = join(tmp, 'ca.pem');
    const sh = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
    const p12 = (name: string, ...extra: string[]) => {
      const out = join(tmp, name);
      sh([
        'pkcs12',
        '-export',
        '-inkey',
        key,
        '-in',
        crt,
        '-out',
        out,
        '-passout',
        'pass:synthetic-test-only',
        ...extra,
      ]);
      return readFileSync(out);
    };
    const setup = () => {
      sh([
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        crt,
        '-days',
        '1',
        '-subj',
        '/CN=SYNTHETIC-P12-CN',
      ]);
      sh([
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(tmp, 'ca-k.pem'),
        '-out',
        ca,
        '-days',
        '1',
        '-subj',
        '/CN=SYNTHETIC-CA',
      ]);
    };

    it('reads the OpenSSL default format (PBES2/AES, SHA-256 MAC), with a v3 certificate and a chain', async () => {
      setup();
      const signer = P12PadesSigner.fromPkcs12({
        pkcs12: p12('default.p12', '-certfile', ca),
        passphrase: 'synthetic-test-only',
      });
      expect(signer.certificateCommonName).toBe('SYNTHETIC-P12-CN');
      const signed = await signer.sign(await injectCda(makeTestPdf(), cda));
      checkPadesBaselineB(signed, new X509Certificate(readFileSync(crt)));
      expect(Buffer.from(signed).toString('latin1')).toContain('/SubFilter /ETSI.CAdES.detached');
    });

    it('reads SHA-1 MACs and AES-128 encryption', () => {
      setup();
      const file = p12('sha1.p12', '-macalg', 'sha1', '-certpbe', 'AES-128-CBC', '-keypbe', 'AES-128-CBC');
      const signer = P12PadesSigner.fromPkcs12({ pkcs12: file, passphrase: 'synthetic-test-only' });
      expect(signer.certificateCommonName).toBe('SYNTHETIC-P12-CN');
    });

    it('refuses a wrong password and a tampered file without echoing secrets', () => {
      setup();
      const file = p12('x.p12');
      let wrong: Error | undefined;
      try {
        P12PadesSigner.fromPkcs12({ pkcs12: file, passphrase: 'wrong-SECRET-MARKER' });
      } catch (e) {
        wrong = e as Error;
      }
      expect(wrong).toBeInstanceOf(FsePdfError);
      expect(wrong?.message).toMatch(/integrity check failed/);
      expect(wrong?.message).not.toContain('SECRET-MARKER');
      const tampered = Buffer.from(file);
      tampered[tampered.length - 40] = (tampered[tampered.length - 40] ?? 0) ^ 0xff;
      expect(() =>
        P12PadesSigner.fromPkcs12({ pkcs12: tampered, passphrase: 'synthetic-test-only' }),
      ).toThrow(FsePdfError);
      expect(() => readPkcs12(new TextEncoder().encode('not a p12'), 'x')).toThrow(/not a DER PKCS#12/);
    });

    it('refuses legacy (RC2/3DES) encryption with a hint to re-export', () => {
      setup();
      let legacy: Buffer;
      try {
        legacy = p12('legacy.p12', '-legacy');
      } catch {
        return; // this OpenSSL build has no legacy provider
      }
      expect(() => P12PadesSigner.fromPkcs12({ pkcs12: legacy, passphrase: 'synthetic-test-only' })).toThrow(
        /legacy encryption|wrong password or legacy/,
      );
    });
  });

  it('works with an external RSA signer (HSM / remote signing hook)', async () => {
    const key = createPrivateKey(cert.privateKeyPem);
    let calls = 0;
    const signer = new RawSignaturePadesSigner({
      certificates: [cert.certificatePem],
      signRsaSha256: async (data) => {
        calls++;
        return cryptoSign('sha256', data, key);
      },
    });
    checkPadesBaselineB(await signer.sign(makeTestPdf()), new X509Certificate(cert.certificatePem));
    expect(calls).toBe(1);
  });

  it('refuses mismatched keys, expired certificates and non-PDF input, without leaking the key', async () => {
    const other = createTestCertificate();
    expect(() =>
      P12PadesSigner.fromPem({ privateKeyPem: other.privateKeyPem, certificatePem: cert.certificatePem }),
    ).toThrow(/does not match/);
    const old = createTestCertificate({ validFrom: new Date('2020-01-01T00:00:00Z'), validDays: 1 });
    const expired = P12PadesSigner.fromPem({
      privateKeyPem: old.privateKeyPem,
      certificatePem: old.certificatePem,
    });
    await expect(expired.sign(makeTestPdf())).rejects.toThrow(/not currently valid/);
    const signer = P12PadesSigner.fromPem({
      privateKeyPem: cert.privateKeyPem,
      certificatePem: cert.certificatePem,
    });
    await expect(signer.sign(new TextEncoder().encode('not a pdf'))).rejects.toBeInstanceOf(FsePdfError);
    const keyLine = cert.privateKeyPem.split('\n')[1] ?? '';
    expect(inspect(signer, { depth: 10, showHidden: true })).not.toContain(keyLine);
    expect(JSON.stringify(signer)).toBe(
      '{"type":"P12PadesSigner","certificateCommonName":"SYNTHETIC-PADES-CN"}',
    );
  });

  it('refuses a PDF with a stray /ByteRange that could hang the placeholder search', async () => {
    const signer = P12PadesSigner.fromPem({
      privateKeyPem: cert.privateKeyPem,
      certificatePem: cert.certificatePem,
    });
    // The text ends up verbatim in an uncompressed content stream.
    await expect(signer.sign(makeTestPdf('/ByteRange [0 1'))).rejects.toThrow(/ByteRange/);
  });
});
