import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultTransactionOutcome,
  FseAuthError,
  FseConfigError,
  FseGatewayClient,
  FseNotFoundError,
  RsaPemJwtSigner,
} from '../src/index.js';
import type * as TlsModule from '../src/tls.js';
import { application, context, testCertificates } from './helpers.js';

const mocks = vi.hoisted(() => ({ agent: undefined as unknown }));
vi.mock('../src/tls.js', async (importOriginal) => {
  const original = await importOriginal<typeof TlsModule>();
  return { ...original, createMtlsAgent: () => mocks.agent };
});

const ORIGIN = 'https://modipa-val.fse.salute.gov.it';
const WIF = 'wf.1^^^^urn:ihe:iti:xdw:2013:workflowInstanceId';
const PATH = `/govway/rest/in/FSE/gateway/v1/status/${encodeURIComponent(WIF)}`;
const fast = { subject: context.subject, initialDelayMs: 1, maxDelayMs: 2 };

let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  mocks.agent = agent;
});
afterEach(async () => {
  await agent.close();
});

function client() {
  const { signature, tls } = testCertificates();
  return new FseGatewayClient({
    tls: { cert: tls.certificatePem, key: tls.privateKeyPem },
    signer: RsaPemJwtSigner.fromPem({
      certificatePem: signature.certificatePem,
      privateKeyPem: signature.privateKeyPem,
    }),
    application,
  });
}

function reply(status: number, events?: Array<Record<string, string>>) {
  agent
    .get(ORIGIN)
    .intercept({ path: PATH, method: 'GET' })
    .reply(status, events ? { traceID: 't', transactionData: events } : { status, title: 'x' });
}

describe('getStatus environment', () => {
  it('is refused locally in production, where guide §13 says the service does not exist', async () => {
    const { signature, tls } = testCertificates();
    const prod = new FseGatewayClient({
      environment: 'prod',
      tls: { cert: tls.certificatePem, key: tls.privateKeyPem },
      signer: RsaPemJwtSigner.fromPem({
        certificatePem: signature.certificatePem,
        privateKeyPem: signature.privateKeyPem,
      }),
      application,
    });
    await expect(prod.getStatus(WIF, { subject: context.subject })).rejects.toBeInstanceOf(FseConfigError);
    agent.assertNoPendingInterceptors();
  });
});

describe('waitForStatus', () => {
  it('retries 404 and pending states, then reports success', async () => {
    reply(404);
    reply(200, [{ eventType: 'VALIDATION', eventStatus: 'SUCCESS' }]);
    reply(200, [
      { eventType: 'PUBLICATION', eventStatus: 'SUCCESS' },
      { eventType: 'SEND_TO_INI', eventStatus: 'SUCCESS' },
    ]);
    const result = await client().waitForStatus(WIF, fast);
    expect(result.outcome).toBe('success');
    expect(result.attempts).toBe(3);
    expect(result.status?.transactionData).toHaveLength(2);
  });

  it('reports failure on BLOCKING_ERROR', async () => {
    reply(200, [{ eventType: 'SEND_TO_INI', eventStatus: 'BLOCKING_ERROR' }]);
    await expect(client().waitForStatus(WIF, fast)).resolves.toMatchObject({
      outcome: 'failure',
      attempts: 1,
    });
  });

  it('stops after maxAttempts with outcome pending', async () => {
    for (let i = 0; i < 3; i++) reply(200, [{ eventType: 'PUBLICATION', eventStatus: 'SUCCESS' }]);
    const result = await client().waitForStatus(WIF, { ...fast, maxAttempts: 3 });
    expect(result).toMatchObject({ outcome: 'pending', attempts: 3 });
  });

  it('rethrows the last transient error if no status was ever received', async () => {
    reply(404);
    reply(404);
    await expect(client().waitForStatus(WIF, { ...fast, maxAttempts: 2 })).rejects.toBeInstanceOf(
      FseNotFoundError,
    );
  });

  it('does not retry non-transient errors', async () => {
    reply(403);
    await expect(client().waitForStatus(WIF, fast)).rejects.toBeInstanceOf(FseAuthError);
  });

  it('can be aborted while waiting', async () => {
    reply(200, [{ eventType: 'PUBLICATION', eventStatus: 'SUCCESS' }]);
    const controller = new AbortController();
    const pending = client().waitForStatus(WIF, {
      subject: context.subject,
      initialDelayMs: 60_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('stop')), 5);
    await expect(pending).rejects.toThrow('stop');
  });

  it('refuses unbounded settings', async () => {
    const c = client();
    for (const bad of [
      { maxAttempts: 0 },
      { maxAttempts: 101 },
      { maxAttempts: Infinity },
      { maxAttempts: 2.5 },
      { initialDelayMs: -1 },
      { maxDelayMs: 300_001 },
      { backoffFactor: 0.5 },
    ]) {
      await expect(c.waitForStatus(WIF, { ...fast, ...bad })).rejects.toBeInstanceOf(FseConfigError);
    }
  });

  it('accepts a custom end-of-transaction rule', async () => {
    reply(200, [{ eventType: 'PUBLICATION', eventStatus: 'SUCCESS' }]);
    const result = await client().waitForStatus(WIF, {
      ...fast,
      isFinal: (events) => (events.some((e) => e.eventType === 'PUBLICATION') ? 'success' : undefined),
    });
    expect(result.outcome).toBe('success');
  });
});

describe('defaultTransactionOutcome', () => {
  it('follows the event types of guide §12.6 and §13.2', () => {
    expect(defaultTransactionOutcome([])).toBeUndefined();
    expect(defaultTransactionOutcome([{ eventType: 'INI_DELETE', eventStatus: 'SUCCESS' }])).toBe('success');
    expect(defaultTransactionOutcome([{ eventType: 'INI_UPDATE', eventStatus: 'SUCCESS' }])).toBe('success');
    expect(defaultTransactionOutcome([{ eventType: 'UAR_FINAL_STATUS', eventStatus: 'SUCCESS' }])).toBe(
      'success',
    );
    expect(defaultTransactionOutcome([{ eventType: 'VALIDATION', eventStatus: 'BLOCKING_ERROR' }])).toBe(
      'failure',
    );
  });
});
