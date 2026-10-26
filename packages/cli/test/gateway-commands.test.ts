import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTestPdf,
  readSyntheticCda,
  SYNTHETIC_FISCAL_CODE,
  SYNTHETIC_PERSON_ID,
} from '@massimiliano-dev/fse-fixtures';
import { FseAuthError, FseValidationError } from '@massimiliano-dev/fse-gateway-client';
import { injectCda } from '@massimiliano-dev/fse-pdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';
import { captureIo, fakeGateway, makeWorkspace } from './helpers.js';

let ws: Awaited<ReturnType<typeof makeWorkspace>>;
const REAL_LOOKING_CF = ['RSSMRA', '85T10A562S'].join('');
const WIF = 'wf.1^^^^urn:ihe:iti:xdw:2013:workflowInstanceId';
const DOC_ID = '2.16.840.1.113883.2.9.2.999.4.4^SYNTHETIC1';

const metadata = {
  tipologiaStruttura: 'Ospedale',
  tipoDocumentoLivAlto: 'REF',
  assettoOrganizzativo: 'AD_PSC001',
  tipoAttivitaClinica: 'CON',
  identificativoSottomissione: '2.16.840.1.113883.2.9.2.999.4.3.1',
  administrativeRequest: ['SSN'],
};

beforeAll(async () => {
  ws = await makeWorkspace();
  await writeFile(join(ws.dir, 'prepared.pdf'), await injectCda(makeTestPdf(), readSyntheticCda()));
  await writeFile(
    join(ws.dir, 'publish.json'),
    JSON.stringify({
      ...metadata,
      identificativoDoc: DOC_ID,
      identificativoRep: '2.16.840.1.113883.2.9.2.999.4.5.1',
    }),
  );
  await writeFile(join(ws.dir, 'metadata.json'), JSON.stringify(metadata));
  await writeFile(
    join(ws.dir, 'patient.json'),
    JSON.stringify({ personId: SYNTHETIC_PERSON_ID, resourceHl7Type: "('11488-4^^2.16.840.1.113883.6.1')" }),
  );
  await writeFile(join(ws.dir, 'patient-no-type.json'), JSON.stringify({ personId: SYNTHETIC_PERSON_ID }));
});
afterAll(() => ws.cleanup());

interface DryRun {
  dryRun: boolean;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    signatureClaims?: Record<string, unknown>;
    multipart?: { requestBody: Record<string, unknown> };
    json?: Record<string, unknown>;
  };
}

async function dryRun(args: string[]): Promise<DryRun> {
  const gateway = fakeGateway();
  const io = captureIo(ws.dir, ws.env, gateway.factory);
  const code = await runCli([...args, '--dry-run'], io);
  expect(io.err).toBe(code === 0 ? io.err : '');
  expect(code).toBe(0);
  expect(gateway.calls).toEqual([]); // dry runs never call the network methods
  expect(io.out).not.toMatch(/eyJ[\w-]+\.[\w-]+/);
  expect(io.out).not.toContain(SYNTHETIC_FISCAL_CODE);
  expect(io.out).not.toContain('PRIVATE KEY');
  return JSON.parse(io.out) as DryRun;
}

describe('fse validate --gateway', () => {
  it('validates a prepared PDF and prints JSON with --json', async () => {
    const gateway = fakeGateway({ validate: { httpStatus: 201, workflowInstanceId: WIF } });
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    const code = await runCli(
      [
        'validate',
        'prepared.pdf',
        '--gateway',
        '--env',
        'pre',
        '--activity',
        'VALIDATION',
        '--json',
        '--schema',
        'missing.xsd',
        '--no-local-validation',
      ],
      io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(io.out)).toEqual({
      ok: true,
      operation: 'validate',
      httpStatus: 201,
      workflowInstanceId: WIF,
    });
    const input = gateway.calls[0]?.args[0] as { requestBody: unknown; context: { personId: string } };
    expect(input.requestBody).toEqual({ activity: 'VALIDATION' });
    expect(input.context.personId).toBe(SYNTHETIC_PERSON_ID);
  });

  it('exits 1 with the redacted gateway problem when the document is rejected', async () => {
    const error = new FseValidationError('Gateway rejected the request (HTTP 422): /msg/semantic', {
      status: 422,
      operation: 'validate',
      problem: {
        type: '/msg/semantic',
        detail: `ERRORE-12| codice fiscale ${REAL_LOOKING_CF}`,
        traceID: 't',
      },
    });
    const io = captureIo(ws.dir, ws.env, fakeGateway({ validate: error }).factory);
    const code = await runCli(
      ['validate', 'prepared.pdf', '--gateway', '--env', 'pre', '--no-local-validation', '--json'],
      io,
    );
    expect(code).toBe(1);
    expect(io.out + io.err).not.toContain(REAL_LOOKING_CF);
    expect(JSON.parse(io.out)).toMatchObject({
      ok: false,
      error: { name: 'FseValidationError', status: 422 },
    });
    expect(io.err).toContain('(traceID t)');
  });

  it('exits 3 when the gateway refuses the credentials', async () => {
    const error = new FseAuthError('Gateway refused the credentials (HTTP 403)', {
      status: 403,
      operation: 'validate',
    });
    const io = captureIo(ws.dir, ws.env, fakeGateway({ validate: error }).factory);
    expect(
      await runCli(['validate', 'prepared.pdf', '--gateway', '--env', 'pre', '--no-local-validation'], io),
    ).toBe(3);
  });

  it('requires --pdf for an XML input', async () => {
    const io = captureIo(ws.dir, ws.env, fakeGateway().factory);
    expect(
      await runCli(['validate', 'cda.xml', '--gateway', '--env', 'pre', '--no-local-validation'], io),
    ).toBe(2);
    expect(io.err).toMatch(/--pdf/);
  });
});

describe('production safeguards', () => {
  it('refuses --env prod without --confirm-production and always warns', async () => {
    const gateway = fakeGateway();
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    expect(await runCli(['status', WIF, '--env', 'prod'], io)).toBe(2);
    expect(io.err).toMatch(/PRODUCTION/);
    expect(io.err).toMatch(/accredited system/);
    expect(io.err).toMatch(/--confirm-production/);
    expect(gateway.calls).toEqual([]);

    const confirmed = captureIo(ws.dir, ws.env, fakeGateway().factory);
    expect(
      await runCli(['status', WIF, '--env', 'prod', '--confirm-production', '--dry-run'], confirmed),
    ).toBe(0);
    expect(confirmed.err).toMatch(/PRODUCTION/);
    expect(JSON.parse(confirmed.out).request.url).toMatch(/^https:\/\/modipa\.fse\.salute\.gov\.it\//);
  });
});

describe('fse publish', () => {
  it('requires a workflowInstanceId from a previous validation', async () => {
    const io = captureIo(ws.dir, ws.env, fakeGateway().factory);
    expect(await runCli(['publish', 'prepared.pdf', '--env', 'pre', '--metadata', 'publish.json'], io)).toBe(
      2,
    );
    expect(io.err).toMatch(/workflowInstanceId is required/);
  });

  it('--dry-run shows the creation claims and the request body', async () => {
    const summary = await dryRun([
      'publish',
      'prepared.pdf',
      '--env',
      'pre',
      '--metadata',
      'publish.json',
      '--workflow-instance-id',
      WIF,
    ]);
    expect(summary.request.method).toBe('POST');
    expect(summary.request.url).toBe(
      'https://modipa-val.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1/documents',
    );
    expect(summary.request.signatureClaims).toMatchObject({
      action_id: 'CREATE',
      purpose_of_use: 'TREATMENT',
      person_id: '[REDACTED]',
    });
    expect(summary.request.signatureClaims?.attachment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.request.multipart?.requestBody).toMatchObject({
      workflowInstanceId: WIF,
      identificativoDoc: DOC_ID,
      mode: 'ATTACHMENT',
    });
  });

  it('publishes, warns about an unsigned PDF and prints the result', async () => {
    const gateway = fakeGateway({ publish: { httpStatus: 202, workflowInstanceId: WIF, traceID: 'tr' } });
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    const code = await runCli(
      [
        'publish',
        'prepared.pdf',
        '--env',
        'pre',
        '--metadata',
        'publish.json',
        '--workflow-instance-id',
        WIF,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(io.err).toMatch(/has no signature/);
    expect(io.out).toMatch(/^ACCEPTED \(HTTP 202\)/);
    expect((gateway.calls[0]?.args[0] as { requestBody: unknown }).requestBody).toMatchObject({
      workflowInstanceId: WIF,
    });
  });

  it('refuses an invalid metadata file before any network call (exit 2)', async () => {
    await writeFile(join(ws.dir, 'bad.json'), JSON.stringify({ ...metadata, extra: true }));
    const gateway = fakeGateway();
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    expect(
      await runCli(
        ['publish', 'prepared.pdf', '--env', 'pre', '--metadata', 'bad.json', '--workflow-instance-id', WIF],
        io,
      ),
    ).toBe(2);
    expect(io.err).toMatch(/extra \(unknown field\)/);
  });
});

describe('fse replace / delete / metadata', () => {
  it('replace --dry-run encodes idDoc and uses the replacement claims', async () => {
    const summary = await dryRun([
      'replace',
      DOC_ID,
      'prepared.pdf',
      '--env',
      'pre',
      '--metadata',
      'publish.json',
    ]);
    expect(summary.request.method).toBe('PUT');
    expect(summary.request.url).toMatch(
      /\/documents\/2\.16\.840\.1\.113883\.2\.9\.2\.999\.4\.4%5ESYNTHETIC1$/,
    );
    expect(summary.request.signatureClaims).toMatchObject({ action_id: 'UPDATE', purpose_of_use: 'UPDATE' });
  });

  it('delete --dry-run sends no attachment_hash and no resource_hl7_type when the patient file has none', async () => {
    const summary = await dryRun(['delete', DOC_ID, '--env', 'pre', '--patient', 'patient-no-type.json']);
    expect(summary.request.method).toBe('DELETE');
    expect(summary.request.signatureClaims).toMatchObject({ action_id: 'DELETE', purpose_of_use: 'UPDATE' });
    expect(summary.request.signatureClaims).not.toHaveProperty('attachment_hash');
    expect(summary.request.signatureClaims).not.toHaveProperty('resource_hl7_type');
  });

  it('delete refuses a path-traversal idDoc (exit 2)', async () => {
    const gateway = fakeGateway();
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    expect(await runCli(['delete', '../../status', '--env', 'pre', '--patient', 'patient.json'], io)).toBe(2);
    expect(gateway.calls).toEqual([]);
  });

  it('metadata sends the JSON body with the update claims', async () => {
    const gateway = fakeGateway({ updateMetadata: { httpStatus: 200, workflowInstanceId: WIF } });
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    expect(
      await runCli(
        ['metadata', DOC_ID, '--env', 'pre', '--metadata', 'metadata.json', '--patient', 'patient.json'],
        io,
      ),
    ).toBe(0);
    expect(io.out).toMatch(/^UPDATED \(HTTP 200\)/);
    const summary = await dryRun([
      'metadata',
      DOC_ID,
      '--env',
      'pre',
      '--metadata',
      'metadata.json',
      '--patient',
      'patient.json',
      '--endpoint',
      'iti-57',
    ]);
    expect(summary.request.url).toMatch(/\/metadata-iti-57$/);
    expect(summary.request.json).toEqual(metadata);
  });

  it('oscuramento-catena uses the fixed claims and is refused in production', async () => {
    const summary = await dryRun([
      'metadata',
      DOC_ID,
      '--env',
      'pre',
      '--patient',
      'patient.json',
      '--endpoint',
      'oscuramento-catena',
    ]);
    expect(summary.request.json).toEqual({ attiCliniciRegoleAccesso: ['P99'] });
    expect(summary.request.signatureClaims).toMatchObject({
      purpose_of_use: 'SYSADMIN',
      subject_role: 'NOR',
      locality: '[REDACTED]',
    });
    const io = captureIo(ws.dir, ws.env, fakeGateway().factory);
    expect(
      await runCli(
        [
          'metadata',
          DOC_ID,
          '--env',
          'prod',
          '--confirm-production',
          '--patient',
          'patient.json',
          '--endpoint',
          'oscuramento-catena',
        ],
        io,
      ),
    ).toBe(2);
    expect(io.err).toMatch(/not available in production/);
  });
});

describe('fse status', () => {
  const events = [{ eventType: 'SEND_TO_INI', eventStatus: 'SUCCESS', eventDate: '2026-10-26T10:00:00Z' }];

  it('prints the events of a transaction', async () => {
    const gateway = fakeGateway({ getStatus: { httpStatus: 200, transactionData: events } });
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    expect(await runCli(['status', WIF, '--env', 'pre'], io)).toBe(0);
    expect(io.out).toContain('SEND_TO_INI  SUCCESS');
    expect(gateway.calls[0]?.args).toEqual([
      WIF,
      { subject: 'OPERAT00X00X000Z^^^&2.16.840.1.113883.2.9.4.3.2&ISO' },
    ]);
  });

  it('queries by trace id and sends only the Bearer token', async () => {
    const summary = await dryRun(['status', '--trace', '3f67b89ba72ed40b', '--env', 'pre']);
    expect(summary.request.url).toMatch(/\/status\/search\/3f67b89ba72ed40b$/);
    expect(summary.request.headers).toEqual({
      authorization: 'Bearer [REDACTED:JWT]',
      accept: 'application/json',
    });
    expect(summary.request).not.toHaveProperty('signatureClaims');
  });

  it.each([
    ['success', 0],
    ['failure', 1],
    ['pending', 4],
  ] as const)('--wait maps outcome %s to exit %d', async (outcome, exit) => {
    const gateway = fakeGateway({
      waitForStatus: { outcome, attempts: 3, status: { httpStatus: 200, transactionData: events } },
    });
    const io = captureIo(ws.dir, ws.env, gateway.factory);
    expect(await runCli(['status', WIF, '--env', 'pre', '--wait', '--max-attempts', '3', '--json'], io)).toBe(
      exit,
    );
    expect(JSON.parse(io.out)).toMatchObject({ outcome, attempts: 3 });
    expect(gateway.calls[0]?.args[1]).toMatchObject({ maxAttempts: 3, initialDelayMs: 2000 });
  });

  it('refuses unbounded polling settings and ambiguous arguments', async () => {
    for (const args of [
      ['status', WIF, '--env', 'pre', '--wait', '--max-attempts', '1000'],
      ['status', WIF, '--env', 'pre', '--wait', '--interval-ms', '-5'],
      ['status', '--env', 'pre'],
      ['status', WIF, '--trace', 't', '--env', 'pre'],
    ]) {
      const io = captureIo(ws.dir, ws.env, fakeGateway().factory);
      expect(await runCli(args, io)).toBe(2);
    }
  });
});
