import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { createTestCertificate, makeTestPdf } from '@massimiliano-dev/fse-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FseGatewayClient, FseTransportError, RsaPemJwtSigner } from '../src/index.js';
import { application, context, testCertificates } from './helpers.js';

// A local HTTPS server standing in for the gateway (no mocks): proves that server certificates are
// verified (MITM protection) and that the client certificate is presented (mTLS).
const server = createTestCertificate({ commonName: 'localhost' });
let https: Server;
let baseUrl: string;
let seenClientCn: string | undefined;

beforeAll(async () => {
  const { tls } = testCertificates();
  https = createServer(
    {
      cert: server.certificatePem,
      key: server.privateKeyPem,
      ca: [tls.certificatePem],
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      const cn = (req.socket as TLSSocket).getPeerCertificate().subject?.CN;
      seenClientCn = Array.isArray(cn) ? cn[0] : cn;
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ traceID: 'loopback', warning: 'synthetic' }));
      });
    },
  );
  await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
  baseUrl = `https://localhost:${(https.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => https.close(() => resolve()));
});

function client(ca?: string) {
  const { signature, tls } = testCertificates();
  return new FseGatewayClient({
    baseUrl,
    tls: { cert: tls.certificatePem, key: tls.privateKeyPem, ...(ca ? { ca, caOnly: true } : {}) },
    signer: RsaPemJwtSigner.fromPem({
      certificatePem: signature.certificatePem,
      privateKeyPem: signature.privateKeyPem,
    }),
    application,
    timeoutMs: 5_000,
  });
}

const input = { pdf: makeTestPdf(), requestBody: { activity: 'VERIFICA' as const }, context };

describe('TLS against a local server', () => {
  it('rejects a server certificate that is not trusted', async () => {
    const c = client();
    const error = await c.validate(input).catch((e: unknown) => e);
    await c.close();
    expect(error).toBeInstanceOf(FseTransportError);
    expect((error as Error).message).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
  });

  it('completes the mutual TLS handshake when the server CA is pinned', async () => {
    const c = client(server.certificatePem);
    const result = await c.validate(input);
    await c.close();
    expect(result).toMatchObject({ httpStatus: 200, traceID: 'loopback', warning: 'synthetic' });
    expect(seenClientCn).toBe('SYNTHETIC-TLS-CN');
  });
});
