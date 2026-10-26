import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYNTHETIC_FISCAL_CODE } from '@massimiliano-dev/fse-fixtures';
import { runCli } from '../src/index.js';
import { captureIo, fakeGateway, makeWorkspace } from './helpers.js';

let ws: Awaited<ReturnType<typeof makeWorkspace>>;

beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => ws.cleanup());

const args = ['send', 'cda.xml', 'document.pdf', '--env', 'pre', '--no-local-validation'];

describe('fse send', () => {
  it('--dry-run builds the request and prints only a redacted summary', async () => {
    const io = captureIo(ws.dir, ws.env, fakeGateway().factory);
    expect(await runCli([...args, '--dry-run'], io)).toBe(0);
    const summary = JSON.parse(io.out) as {
      dryRun: boolean;
      request: {
        url: string;
        multipart: { requestBody: unknown; file: { size: number; sha256: string } };
        signatureClaims: Record<string, unknown>;
      };
    };
    expect(summary.dryRun).toBe(true);
    expect(summary.request.url).toBe(
      'https://modipa-val.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1/documents/validation',
    );
    expect(summary.request.multipart.requestBody).toEqual({
      healthDataFormat: 'CDA',
      mode: 'ATTACHMENT',
      activity: 'VERIFICA',
    });
    expect(summary.request.signatureClaims).toMatchObject({
      action_id: 'CREATE',
      purpose_of_use: 'TREATMENT',
      person_id: '[REDACTED]',
      sub: '[REDACTED]',
      resource_hl7_type: "('11488-4^^2.16.840.1.113883.6.1')",
      attachment_hash: summary.request.multipart.file.sha256,
    });

    // Nothing secret or personal in the output.
    expect(io.out).not.toMatch(/eyJ[\w-]+\.[\w-]+/);
    expect(io.out).not.toContain(SYNTHETIC_FISCAL_CODE);
    expect(io.out).not.toContain('OPERAT00X00X000Z');
    expect(io.out).not.toContain('PRIVATE KEY');
    expect(io.out).not.toContain('<ClinicalDocument');
    expect(io.err).toBe('');
  });

  it('sends through the gateway client and prints the result', async () => {
    const gateway = fakeGateway({ validate: { httpStatus: 200, traceID: 'trace-1', warning: 'w' } });
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    expect(await runCli(args, io)).toBe(0);
    expect(io.out).toMatch(/^VALID \(gateway, HTTP 200, VERIFICA\)/);
    expect(io.out).toContain('traceID: trace-1');
    expect(gateway.calls.map((c) => c.method)).toEqual(['validate']);
  });

  it('reads credentials only from environment variables, never from flags', async () => {
    const io = captureIo(ws.dir, {}, fakeGateway().factory);
    expect(await runCli([...args, '--dry-run'], io)).toBe(2);
    expect(io.err).toMatch(/FSE_CONTEXT_FILE|FSE_SIGN_CERT_FILE/);

    const withFlag = captureIo(ws.dir, ws.env, fakeGateway().factory);
    expect(await runCli([...args, '--dry-run', '--key', 'sign-key.pem'], withFlag)).toBe(2);
    expect(withFlag.err).toMatch(/unknown option '--key'/);
  });

  it('warns when a private key file is readable by others', async () => {
    const { chmod } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await chmod(join(ws.dir, 'sign-key.pem'), 0o644);
    const io = captureIo(ws.dir, ws.env, fakeGateway().factory);
    expect(await runCli([...args, '--dry-run'], io)).toBe(0);
    expect(io.err).toMatch(/chmod 600/);
    await chmod(join(ws.dir, 'sign-key.pem'), 0o600);
  });

  it('requires a valid --env', async () => {
    const io = captureIo(ws.dir, ws.env);
    expect(await runCli(['send', 'cda.xml', 'document.pdf', '--env', 'test', '--dry-run'], io)).toBe(2);
  });
});
