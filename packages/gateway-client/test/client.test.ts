import { inspect } from 'node:util';
import { makeTestPdf, SYNTHETIC_FISCAL_CODE } from '@massimiliano-dev/fse-fixtures';
import { FormData, MockAgent, Response } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FseAuthError,
  FseConfigError,
  FseGatewayClient,
  FseGatewayError,
  FseTransportError,
  FseValidationError,
  NotImplementedError,
  RsaPemJwtSigner,
  summarizePreparedRequest,
} from '../src/index.js';
import type * as TlsModule from '../src/tls.js';
import { application, context, decodeSegment, testCertificates } from './helpers.js';

const mocks = vi.hoisted(() => ({ agent: undefined as unknown }));

// Replace only the agent factory: TLS options are still built and checked by the real code.
vi.mock('../src/tls.js', async (importOriginal) => {
  const original = await importOriginal<typeof TlsModule>();
  return { ...original, createMtlsAgent: () => mocks.agent };
});

const ORIGIN = 'https://modipa-val.fse.salute.gov.it';
const PATH = '/govway/rest/in/FSE/gateway/v1/documents/validation';
const REAL_LOOKING_CF = ['RSSMRA', '85T10A562S'].join('');

let agent: MockAgent;

function newClient(extra: Record<string, unknown> = {}) {
  const { signature, tls } = testCertificates();
  return new FseGatewayClient({
    environment: 'pre',
    tls: { cert: tls.certificatePem, key: tls.privateKeyPem },
    signer: RsaPemJwtSigner.fromPem({
      certificatePem: signature.certificatePem,
      privateKeyPem: signature.privateKeyPem,
    }),
    application,
    ...extra,
  });
}

const input = () => ({ pdf: makeTestPdf(), requestBody: { activity: 'VERIFICA' as const }, context });

describe('FseGatewayClient.validate', () => {
  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    mocks.agent = agent;
  });
  afterEach(async () => {
    await agent.close();
  });

  it('sends a multipart request with both JWT headers and returns the result', async () => {
    let captured: { headers: Record<string, string>; body: string } | undefined;
    agent
      .get(ORIGIN)
      .intercept({ path: PATH, method: 'POST' })
      .reply(async (opts) => {
        // Serialise the FormData exactly as undici puts it on the wire.
        expect(opts.body).toBeInstanceOf(FormData);
        const text = await new Response(opts.body as FormData).text();
        captured = { headers: opts.headers as Record<string, string>, body: text };
        return {
          statusCode: 201,
          data: JSON.stringify({
            traceID: 't1',
            spanID: 's1',
            workflowInstanceId: 'wf^^^^urn:ihe:iti:xdw:2013:workflowInstanceId',
          }),
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const client = newClient();
    const result = await client.validate(input());
    expect(result).toEqual({
      httpStatus: 201,
      traceID: 't1',
      spanID: 's1',
      workflowInstanceId: 'wf^^^^urn:ihe:iti:xdw:2013:workflowInstanceId',
    });

    expect(captured).toBeDefined();
    const headers = captured!.headers;
    expect(headers.authorization).toMatch(/^Bearer eyJ/);
    expect(headers['fse-jwt-signature']).toMatch(/^eyJ/);
    expect(headers.accept).toBe('application/json');
    expect(decodeSegment(headers['fse-jwt-signature']!, 1).aud).toBe(
      `${ORIGIN}/govway/rest/in/FSE/gateway/v1`,
    );
    expect(captured!.body).toContain('name="requestBody"');
    expect(captured!.body).toContain('{"healthDataFormat":"CDA","mode":"ATTACHMENT","activity":"VERIFICA"}');
    expect(captured!.body).toMatch(/name="file"; filename="document.pdf"\r\nContent-Type: application\/pdf/);
    expect(captured!.body).toContain('%PDF-1.7');
  });

  it('maps 400/422 to FseValidationError with the typed, redacted problem list', async () => {
    agent
      .get(ORIGIN)
      .intercept({ path: PATH, method: 'POST' })
      .reply(422, {
        traceID: 'abc',
        spanID: 'abc',
        type: '/msg/semantic',
        title: 'Errore semantico.',
        detail: `ERRORE-12| codice fiscale ${REAL_LOOKING_CF} non valido`,
        status: 422,
        instance: '/validation/error',
        workflowInstanceId: 'wf',
      });
    const error = await newClient()
      .validate(input())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FseValidationError);
    const v = error as FseValidationError;
    expect(v.status).toBe(422);
    expect(v.traceId).toBe('abc');
    expect(v.errors).toEqual([
      {
        type: '/msg/semantic',
        title: 'Errore semantico.',
        detail: 'ERRORE-12| codice fiscale [REDACTED:CF] non valido',
        instance: '/validation/error',
      },
    ]);
    expect(JSON.stringify(v)).not.toContain(REAL_LOOKING_CF);
    expect(v.message).toContain('/msg/semantic');
  });

  it('maps 401/403 to FseAuthError and 5xx to FseGatewayError', async () => {
    agent
      .get(ORIGIN)
      .intercept({ path: PATH, method: 'POST' })
      .reply(403, { title: 'Token jwt mancante o non valido' });
    await expect(newClient().validate(input())).rejects.toBeInstanceOf(FseAuthError);

    agent.get(ORIGIN).intercept({ path: PATH, method: 'POST' }).reply(503, 'Service unavailable');
    const error = await newClient()
      .validate(input())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FseGatewayError);
    expect(error).not.toBeInstanceOf(FseValidationError);
    expect((error as FseGatewayError).status).toBe(503);
  });

  it('wraps network failures in FseTransportError without leaking tokens', async () => {
    agent
      .get(ORIGIN)
      .intercept({ path: PATH, method: 'POST' })
      .replyWithError(new Error('connection reset by peer'));
    const error = await newClient()
      .validate(input())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FseTransportError);
    expect(JSON.stringify(error)).not.toContain('eyJ');
    expect(String((error as Error).stack)).not.toContain('eyJ');
  });

  it('refuses oversized responses', async () => {
    agent.get(ORIGIN).intercept({ path: PATH, method: 'POST' }).reply(201, 'x'.repeat(2048));
    await expect(newClient({ maxResponseBytes: 1024 }).validate(input())).rejects.toThrow(
      /exceeds 1024 bytes/,
    );
  });

  it('refuses inputs that are not PDFs', async () => {
    await expect(
      newClient().validate({ ...input(), pdf: new TextEncoder().encode('<xml/>') }),
    ).rejects.toBeInstanceOf(FseConfigError);
  });

  it('prepares a dry-run summary with tokens and personal claims masked', async () => {
    const prepared = await newClient().prepareValidation(input());
    const summary = JSON.stringify(summarizePreparedRequest(prepared));
    expect(summary).not.toMatch(/eyJ[\w-]+\./);
    expect(summary).not.toContain(SYNTHETIC_FISCAL_CODE);
    expect(summary).toContain('"action_id":"CREATE"');
    expect(summary).toContain(prepared.file.sha256);
  });
});

describe('FseGatewayClient configuration', () => {
  beforeEach(() => {
    mocks.agent = new MockAgent();
  });

  it('accepts only HTTPS base URLs', () => {
    expect(() => newClient({ baseUrl: 'http://localhost:8080/v1' })).toThrow(FseConfigError);
    expect(() => newClient({ baseUrl: 'https://user:pw@example.test/v1' })).toThrow(FseConfigError);
    expect(newClient({ baseUrl: 'https://gateway.example.test/v1/' }).baseUrl).toBe(
      'https://gateway.example.test/v1',
    );
  });

  it('does not expose keys through inspect or JSON', () => {
    const { tls, signature } = testCertificates();
    const client = newClient();
    for (const key of [tls.privateKeyPem, signature.privateKeyPem]) {
      const line = key.split('\n')[1] ?? '';
      expect(inspect(client, { depth: 20, showHidden: true })).not.toContain(line);
      expect(JSON.stringify(client)).not.toContain(line);
    }
  });

  it('exposes typed stubs for the publication services', async () => {
    const client = newClient();
    await expect(client.publish({} as never)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(client.replace({} as never)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(client.delete({} as never)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(client.updateMetadata({} as never)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
