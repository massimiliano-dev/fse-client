import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestCertificate, makeTestPdf, readSyntheticCda } from '@massimiliano-dev/fse-fixtures';
import { FseGatewayClient } from '@massimiliano-dev/fse-gateway-client';
import type { CliGatewayClient, CliIo } from '../src/index.js';

/**
 * Captures CLI output. Tests never reach the network: unless a test injects a fake client, creating a
 * gateway client throws.
 */
export function captureIo(
  cwd: string,
  env: Record<string, string> = {},
  createGatewayClient: CliIo['createGatewayClient'] = () => {
    throw new Error('network access is disabled in CLI tests: inject a fake gateway client');
  },
): CliIo & { out: string; err: string } {
  const io = {
    out: '',
    err: '',
    stdout: (text: string) => {
      io.out += text;
    },
    stderr: (text: string) => {
      io.err += text;
    },
    env,
    cwd,
    createGatewayClient,
  };
  return io;
}

/** A call recorded by {@link fakeGateway}. */
export interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * A gateway client whose `prepare*` methods are the real ones (so dry runs sign real tokens) and whose
 * network methods return canned answers or throw the given error. Nothing ever leaves the process.
 */
export function fakeGateway(answers: Partial<Record<keyof CliGatewayClient, unknown>> = {}): {
  factory: NonNullable<CliIo['createGatewayClient']>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const factory: NonNullable<CliIo['createGatewayClient']> = (options) => {
    const real = new FseGatewayClient(options);
    // Network methods first run the real request preparation (so body and path validation behave as in
    // production), then record the call and return the canned answer instead of sending anything.
    const network =
      (method: keyof CliGatewayClient, prepare?: (...args: never[]) => Promise<unknown>) =>
      async (...args: unknown[]) => {
        if (prepare) await (prepare as (...a: unknown[]) => Promise<unknown>)(...args);
        calls.push({ method, args });
        const answer = answers[method];
        if (answer instanceof Error) throw answer;
        return typeof answer === 'function' ? (answer as (...a: unknown[]) => unknown)(...args) : answer;
      };
    const variant = (v: 'metadata' | 'metadata-iti-57') => (i: never) => real.prepareUpdateMetadata(i, v);
    return {
      prepareValidation: (i) => real.prepareValidation(i),
      preparePublish: (i) => real.preparePublish(i),
      prepareReplace: (i) => real.prepareReplace(i),
      prepareDelete: (i) => real.prepareDelete(i),
      prepareUpdateMetadata: (i, v) => real.prepareUpdateMetadata(i, v),
      prepareUpdateMetadataOscuramentoCatena: (i) => real.prepareUpdateMetadataOscuramentoCatena(i),
      prepareStatus: (i) => real.prepareStatus(i),
      validate: network('validate', (i: never) => real.prepareValidation(i)) as CliGatewayClient['validate'],
      publish: network('publish', (i: never) => real.preparePublish(i)) as CliGatewayClient['publish'],
      replace: network('replace', (i: never) => real.prepareReplace(i)) as CliGatewayClient['replace'],
      delete: network('delete', (i: never) => real.prepareDelete(i)) as CliGatewayClient['delete'],
      updateMetadata: network('updateMetadata', variant('metadata')) as CliGatewayClient['updateMetadata'],
      updateMetadataIti57: network(
        'updateMetadataIti57',
        variant('metadata-iti-57'),
      ) as CliGatewayClient['updateMetadataIti57'],
      updateMetadataOscuramentoCatena: network('updateMetadataOscuramentoCatena', (i: never) =>
        real.prepareUpdateMetadataOscuramentoCatena(i),
      ) as CliGatewayClient['updateMetadataOscuramentoCatena'],
      getStatus: network('getStatus', (id: never, q: { subject: string }) =>
        real.prepareStatus({ workflowInstanceId: id, subject: q.subject }),
      ) as CliGatewayClient['getStatus'],
      getStatusByTraceId: network('getStatusByTraceId', (id: never, q: { subject: string }) =>
        real.prepareStatus({ traceId: id, subject: q.subject }),
      ) as CliGatewayClient['getStatusByTraceId'],
      waitForStatus: network('waitForStatus', (id: never, q: { subject: string }) =>
        real.prepareStatus({ workflowInstanceId: id, subject: q.subject }),
      ) as CliGatewayClient['waitForStatus'],
      close: () => real.close(),
    };
  };
  return { factory, calls };
}

/** A temporary workspace with synthetic CDA, PDF, context file and throwaway credentials (mode 600). */
export async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'fse-cli-test-'));
  const sign = createTestCertificate({ commonName: 'SYNTHETIC-SIGN-CN' });
  const tls = createTestCertificate({ commonName: 'SYNTHETIC-TLS-CN' });
  const files: Record<string, string | Uint8Array> = {
    'cda.xml': readSyntheticCda(),
    'document.pdf': makeTestPdf(),
    'sign-cert.pem': sign.certificatePem,
    'sign-key.pem': sign.privateKeyPem,
    'tls-cert.pem': tls.certificatePem,
    'tls-key.pem': tls.privateKeyPem,
    'context.json': JSON.stringify({
      subject: 'OPERAT00X00X000Z^^^&2.16.840.1.113883.2.9.4.3.2&ISO',
      subjectRole: 'AAS',
      subjectOrganizationId: '999',
      subjectOrganization: 'Regione Sintetica',
      locality: 'STRUTTURA SINTETICA^^^^^&2.16.840.1.113883.2.9.4.1.3&ISO^^^^999999999999',
      patientConsent: true,
      application: { id: 'FSECLIENT-TEST', vendor: 'SYNTHETIC VENDOR', version: '0.0.0' },
    }),
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
    if (name.endsWith('key.pem')) await chmod(join(dir, name), 0o600);
  }
  const env = {
    FSE_SIGN_CERT_FILE: 'sign-cert.pem',
    FSE_SIGN_KEY_FILE: 'sign-key.pem',
    FSE_TLS_CERT_FILE: 'tls-cert.pem',
    FSE_TLS_KEY_FILE: 'tls-key.pem',
    FSE_CONTEXT_FILE: 'context.json',
  };
  return { dir, env, sign, tls, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
