import { makeTestPdf, SYNTHETIC_FISCAL_CODE } from '@massimiliano-dev/fse-fixtures';
import { FormData, MockAgent, Response } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FseConfigError,
  FseGatewayClient,
  FseGatewayError,
  FseNotFoundError,
  FseValidationError,
  RsaPemJwtSigner,
  sha256Hex,
  summarizePreparedRequest,
  type FseRequestContext,
  type PublicationCreationReqDTO,
  type UpdateMetadataReqDTO,
} from '../src/index.js';
import type * as TlsModule from '../src/tls.js';
import { application, context, decodeSegment, testCertificates, verifyRs256 } from './helpers.js';

const mocks = vi.hoisted(() => ({ agent: undefined as unknown }));
vi.mock('../src/tls.js', async (importOriginal) => {
  const original = await importOriginal<typeof TlsModule>();
  return { ...original, createMtlsAgent: () => mocks.agent };
});

const ORIGIN = 'https://modipa-val.fse.salute.gov.it';
const BASE_PATH = '/govway/rest/in/FSE/gateway/v1';
const AUD = `${ORIGIN}${BASE_PATH}`;
const REAL_LOOKING_CF = ['RSSMRA', '85T10A562S'].join('');
const DOC_ID = '2.16.840.1.113883.2.9.2.120.4.4^290700';
const DOC_ID_PATH = '2.16.840.1.113883.2.9.2.120.4.4%5E290700';
const WIF = '2.16.840.1.113883.2.9.2.120.4.4.97bb3fc5.3c55cfd276^^^^urn:ihe:iti:xdw:2013:workflowInstanceId';

let agent: MockAgent;

function newClient() {
  const { signature, tls } = testCertificates();
  return new FseGatewayClient({
    environment: 'pre',
    tls: { cert: tls.certificatePem, key: tls.privateKeyPem },
    signer: RsaPemJwtSigner.fromPem({
      certificatePem: signature.certificatePem,
      privateKeyPem: signature.privateKeyPem,
    }),
    application,
  });
}

interface Captured {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | undefined;
  multipart: boolean;
}

/** Intercepts one request, captures it as sent on the wire, replies with `status` and `data`. */
function intercept(method: string, path: string, status: number, data: unknown = {}): Promise<Captured> {
  return new Promise((resolve) => {
    agent
      .get(ORIGIN)
      .intercept({ path: `${BASE_PATH}${path}`, method })
      .reply(async (opts) => {
        const multipart = opts.body instanceof FormData;
        const body = multipart
          ? await new Response(opts.body as FormData).text()
          : typeof opts.body === 'string'
            ? opts.body
            : undefined;
        resolve({
          method: opts.method,
          path: opts.path,
          headers: opts.headers as Record<string, string>,
          body,
          multipart,
        });
        return {
          statusCode: status,
          data: typeof data === 'string' ? data : JSON.stringify(data),
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });
  });
}

function claimsOf(captured: Captured) {
  const { signature } = testCertificates();
  const auth = captured.headers.authorization ?? '';
  expect(auth).toMatch(/^Bearer eyJ/);
  const authToken = auth.slice('Bearer '.length);
  expect(verifyRs256(authToken, signature.certificatePem)).toBe(true);
  const authClaims = decodeSegment(authToken, 1);
  expect(authClaims.aud).toBe(AUD);
  expect(authClaims.iss).toBe('auth:SYNTHETIC-SIGN-CN');
  const sig = captured.headers['fse-jwt-signature'];
  if (sig === undefined) return { authClaims, signatureClaims: undefined };
  expect(verifyRs256(sig, signature.certificatePem)).toBe(true);
  const signatureClaims = decodeSegment(sig, 1);
  expect(signatureClaims.iss).toBe('integrity:SYNTHETIC-SIGN-CN');
  expect(signatureClaims.aud).toBe(AUD);
  return { authClaims, signatureClaims };
}

/** Extracts the JSON of the `requestBody` multipart part. */
function requestBodyPart(captured: Captured): Record<string, unknown> {
  const match = /name="requestBody"\r\n\r\n(.*?)\r\n--/s.exec(captured.body ?? '');
  return JSON.parse(match?.[1] ?? 'null') as Record<string, unknown>;
}

const metadata: UpdateMetadataReqDTO = {
  tipologiaStruttura: 'Ospedale',
  attiCliniciRegoleAccesso: ['P99'],
  tipoDocumentoLivAlto: 'REF',
  assettoOrganizzativo: 'AD_PSC001',
  dataInizioPrestazione: '20141020110012',
  dataFinePrestazione: '20141020110012',
  tipoAttivitaClinica: 'CON',
  identificativoSottomissione: '2.16.840.1.113883.2.9.2.120.4.3.489592',
  descriptions: ['019655^Bentelan^2.16.840.1.113883.2.9.6.1.5'],
  administrativeRequest: ['SSN'],
};

const creation: PublicationCreationReqDTO = {
  ...metadata,
  identificativoDoc: DOC_ID,
  identificativoRep: '2.16.840.1.113883.2.9.2.120.4.5.1',
  workflowInstanceId: WIF,
  priorita: false,
};

const { workflowInstanceId: _wif, priorita: _p, ...withoutWorkflow } = creation;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  mocks.agent = agent;
});
afterEach(async () => {
  await agent.close();
});

describe('publish (POST /documents)', () => {
  it('sends the multipart body, both JWTs and the creation claims', async () => {
    const pdf = makeTestPdf();
    const sent = intercept('POST', '/documents', 202, {
      traceID: 't',
      spanID: 's',
      workflowInstanceId: WIF,
      warning: `attenzione ${REAL_LOOKING_CF}`,
      fhirBundle: '{"resourceType":"Bundle"}',
    });
    const result = await newClient().publish({ pdf, requestBody: creation, context });
    const captured = await sent;

    expect(captured.multipart).toBe(true);
    expect(captured.headers.accept).toBe('application/json');
    expect(captured.body).toMatch(/name="file"; filename="document.pdf"\r\nContent-Type: application\/pdf/);
    expect(requestBodyPart(captured)).toEqual({ healthDataFormat: 'CDA', mode: 'ATTACHMENT', ...creation });

    const { signatureClaims } = claimsOf(captured);
    expect(signatureClaims).toMatchObject({
      action_id: 'CREATE',
      purpose_of_use: 'TREATMENT',
      attachment_hash: sha256Hex(pdf),
      resource_hl7_type: context.resourceHl7Type,
      person_id: context.personId,
    });

    // The FHIR bundle is health data: dropped unless requested; warnings are redacted.
    expect(result).toEqual({
      httpStatus: 202,
      traceID: 't',
      spanID: 's',
      workflowInstanceId: WIF,
      warning: 'attenzione [REDACTED:CF]',
    });
  });

  it('returns the FHIR bundle only when includeFhirBundle is set', async () => {
    void intercept('POST', '/documents', 202, { fhirBundle: '{"resourceType":"Bundle"}' });
    const result = await newClient().publish({
      pdf: makeTestPdf(),
      requestBody: creation,
      context,
      includeFhirBundle: true,
    });
    expect(result.fhirBundle).toBe('{"resourceType":"Bundle"}');
  });

  it('refuses invalid bodies before signing or sending anything', async () => {
    const client = newClient();
    const pdf = makeTestPdf();
    const bad: Array<[unknown, RegExp]> = [
      [{ ...creation, unexpected: 'x' }, /unexpected \(unknown field\)/],
      [{ ...creation, tipoDocumentoLivAlto: 'XXX' }, /tipoDocumentoLivAlto/],
      [{ ...creation, assettoOrganizzativo: 'AD_PSC016' }, /assettoOrganizzativo/],
      [{ ...creation, identificativoDoc: 'x'.repeat(257) }, /identificativoDoc/],
      [{ ...creation, identificativoRep: '' }, /identificativoRep/],
      [{ ...creation, dataInizioPrestazione: '2014-10-20' }, /dataInizioPrestazione/],
      [{ ...creation, administrativeRequest: ['FREE'] }, /administrativeRequest/],
      [{ ...creation, attiCliniciRegoleAccesso: Array(101).fill('P99') }, /attiCliniciRegoleAccesso/],
      [{ ...creation, workflowInstanceId: 'w'.repeat(257) }, /workflowInstanceId/],
      [{ ...creation, priorita: 'yes' }, /priorita/],
    ];
    for (const [requestBody, message] of bad) {
      const error = await client
        .publish({ pdf, requestBody: requestBody as PublicationCreationReqDTO, context })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FseConfigError);
      expect((error as Error).message).toMatch(message);
    }
    // MockAgent has no interceptor: any request would have failed with a transport error instead.
  });

  it('enforces the classCode/typeCode correlation of guide §16.4', async () => {
    const error = await newClient()
      .publish({ pdf: makeTestPdf(), requestBody: { ...creation, tipoDocumentoLivAlto: 'LDO' }, context })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FseConfigError);
    expect((error as Error).message).toMatch(/expected REF/);
  });

  it('refuses a purpose_of_use that the operation does not allow', async () => {
    await expect(
      newClient().publish({
        pdf: makeTestPdf(),
        requestBody: creation,
        context: { ...context, purposeOfUse: 'SYSADMIN' },
      }),
    ).rejects.toThrow(/purpose_of_use SYSADMIN is not allowed/);
  });

  it('maps errors to typed, redacted errors (including a string status)', async () => {
    void intercept('POST', '/documents', 400, {
      traceID: 'tr',
      type: '/msg/cda-match',
      title: "Errore in fase di recupero dell'esito della verifica.",
      detail: `Il CDA di ${REAL_LOOKING_CF} non risulta validato`,
      status: '400',
      instance: '/msg/cda-validation',
    });
    const error = (await newClient()
      .publish({ pdf: makeTestPdf(), requestBody: creation, context })
      .catch((e: unknown) => e)) as FseValidationError;
    expect(error).toBeInstanceOf(FseValidationError);
    expect(error.problem?.status).toBe(400);
    expect(error.errors[0]?.detail).toBe('Il CDA di [REDACTED:CF] non risulta validato');
    expect(JSON.stringify(error)).not.toContain(REAL_LOOKING_CF);
    expect(error.traceId).toBe('tr');

    void intercept('POST', '/documents', 409, { title: 'Conflict' });
    const conflict = (await newClient()
      .publish({ pdf: makeTestPdf(), requestBody: creation, context })
      .catch((e: unknown) => e)) as FseGatewayError;
    expect(conflict).toBeInstanceOf(FseGatewayError);
    expect(conflict.status).toBe(409);
    expect(conflict.retryable).toBe(false);

    void intercept('POST', '/documents', 503, 'Service unavailable');
    const unavailable = (await newClient()
      .publish({ pdf: makeTestPdf(), requestBody: creation, context })
      .catch((e: unknown) => e)) as FseGatewayError;
    expect(unavailable.retryable).toBe(true);
  });
});

describe('validateAndCreate (POST /documents/validate-and-create)', () => {
  it('uses the creation claims and the ValidateAndCreateDTO', async () => {
    const pdf = makeTestPdf();
    const sent = intercept('POST', '/documents/validate-and-create', 202, { workflowInstanceId: WIF });
    const result = await newClient().validateAndCreate({ pdf, requestBody: withoutWorkflow, context });
    const captured = await sent;
    expect(result.httpStatus).toBe(202);
    expect(requestBodyPart(captured)).toEqual({
      healthDataFormat: 'CDA',
      mode: 'ATTACHMENT',
      ...withoutWorkflow,
    });
    expect(claimsOf(captured).signatureClaims).toMatchObject({
      action_id: 'CREATE',
      purpose_of_use: 'TREATMENT',
      attachment_hash: sha256Hex(pdf),
    });
  });

  it('refuses workflowInstanceId, which ValidateAndCreateDTO does not have', async () => {
    await expect(
      newClient().validateAndCreate({ pdf: makeTestPdf(), requestBody: creation as never, context }),
    ).rejects.toThrow(/workflowInstanceId \(unknown field\)/);
  });
});

describe('replace (PUT /documents/{idDoc})', () => {
  it('encodes idDoc and uses the replacement claims', async () => {
    const pdf = makeTestPdf();
    const sent = intercept('PUT', `/documents/${DOC_ID_PATH}`, 202, { workflowInstanceId: WIF });
    const { priorita: _ignored, ...update } = creation;
    await newClient().replace({ documentId: DOC_ID, pdf, requestBody: update, context });
    const captured = await sent;
    expect(captured.method).toBe('PUT');
    expect(captured.multipart).toBe(true);
    expect(claimsOf(captured).signatureClaims).toMatchObject({
      action_id: 'UPDATE',
      purpose_of_use: 'UPDATE',
      attachment_hash: sha256Hex(pdf),
    });
  });

  it('refuses priorita, which PublicationUpdateReqDTO does not have', async () => {
    await expect(
      newClient().replace({
        documentId: DOC_ID,
        pdf: makeTestPdf(),
        requestBody: creation as never,
        context,
      }),
    ).rejects.toThrow(/priorita \(unknown field\)/);
  });
});

describe('validateAndReplace (PUT /documents/validate-and-replace/{idDoc})', () => {
  it('uses the replacement claims and maps 404 to FseNotFoundError', async () => {
    const sent = intercept('PUT', `/documents/validate-and-replace/${DOC_ID_PATH}`, 404, {
      type: '/msg/record-not-found',
      title: 'Record non trovato.',
      status: 404,
    });
    const error = await newClient()
      .validateAndReplace({ documentId: DOC_ID, pdf: makeTestPdf(), requestBody: withoutWorkflow, context })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FseNotFoundError);
    expect(claimsOf(await sent).signatureClaims).toMatchObject({
      action_id: 'UPDATE',
      purpose_of_use: 'UPDATE',
    });
  });
});

describe('delete (DELETE /documents/{idDoc})', () => {
  it('sends no body, no attachment_hash and no resource_hl7_type when not given', async () => {
    const { resourceHl7Type: _r, ...noType } = context;
    const sent = intercept('DELETE', `/documents/${DOC_ID_PATH}`, 200, {
      traceID: 't',
      workflowInstanceId: WIF,
    });
    const result = await newClient().delete({ documentId: DOC_ID, context: noType });
    const captured = await sent;
    expect(result).toEqual({ httpStatus: 200, traceID: 't', workflowInstanceId: WIF });
    expect(captured.body).toBeUndefined();
    const { signatureClaims } = claimsOf(captured);
    expect(signatureClaims).toMatchObject({ action_id: 'DELETE', purpose_of_use: 'UPDATE' });
    expect(signatureClaims).not.toHaveProperty('attachment_hash');
    expect(signatureClaims).not.toHaveProperty('resource_hl7_type');
  });

  it('accepts 202 (taken in charge after an error)', async () => {
    void intercept('DELETE', `/documents/${DOC_ID_PATH}`, 202, { warning: 'presa in carico' });
    await expect(newClient().delete({ documentId: DOC_ID, context })).resolves.toMatchObject({
      httpStatus: 202,
    });
  });
});

describe('updateMetadata (PUT /documents/{idDoc}/metadata and /metadata-iti-57)', () => {
  it('sends JSON with the update claims', async () => {
    const sent = intercept('PUT', `/documents/${DOC_ID_PATH}/metadata`, 200, { workflowInstanceId: WIF });
    await newClient().updateMetadata({ documentId: DOC_ID, requestBody: metadata, context });
    const captured = await sent;
    expect(captured.headers['content-type']).toBe('application/json');
    expect(JSON.parse(captured.body ?? '')).toEqual(metadata);
    const { signatureClaims } = claimsOf(captured);
    expect(signatureClaims).toMatchObject({ action_id: 'UPDATE', purpose_of_use: 'UPDATE' });
    expect(signatureClaims).not.toHaveProperty('attachment_hash');
  });

  it('allows ACCESS UPDATE but not TREATMENT or SYSADMIN', async () => {
    const sent = intercept('PUT', `/documents/${DOC_ID_PATH}/metadata-iti-57`, 202, {});
    await newClient().updateMetadataIti57({
      documentId: DOC_ID,
      requestBody: metadata,
      context: { ...context, purposeOfUse: 'ACCESS UPDATE' },
    });
    expect(claimsOf(await sent).signatureClaims).toMatchObject({ purpose_of_use: 'ACCESS UPDATE' });

    for (const purposeOfUse of ['TREATMENT', 'SYSADMIN'] as const) {
      await expect(
        newClient().updateMetadata({
          documentId: DOC_ID,
          requestBody: metadata,
          context: { ...context, purposeOfUse },
        }),
      ).rejects.toBeInstanceOf(FseConfigError);
    }
  });

  it('refuses fields that belong to the creation DTO', async () => {
    await expect(
      newClient().updateMetadata({ documentId: DOC_ID, requestBody: creation as never, context }),
    ).rejects.toThrow(/identificativoDoc \(unknown field\)/);
  });
});

describe('updateMetadataOscuramentoCatena (PUT /documents/{idDoc}/metadata-oscuramento-catena)', () => {
  it('sends P99 with the claims fixed by guide §9', async () => {
    const { resourceHl7Type: _r, ...noType } = context;
    const sent = intercept('PUT', `/documents/${DOC_ID_PATH}/metadata-oscuramento-catena`, 200, {
      warning: 'R220 - The requestor is RDA for the patient',
    });
    const result = await newClient().updateMetadataOscuramentoCatena({ documentId: DOC_ID, context: noType });
    const captured = await sent;
    expect(result.warning).toBe('R220 - The requestor is RDA for the patient');
    expect(JSON.parse(captured.body ?? '')).toEqual({ attiCliniciRegoleAccesso: ['P99'] });
    const { signatureClaims } = claimsOf(captured);
    expect(signatureClaims).toMatchObject({
      action_id: 'UPDATE',
      purpose_of_use: 'SYSADMIN',
      subject_role: 'NOR',
      locality: '------',
    });
    expect(signatureClaims).not.toHaveProperty('resource_hl7_type');
  });

  it('refuses any value other than P99', async () => {
    await expect(
      newClient().updateMetadataOscuramentoCatena({
        documentId: DOC_ID,
        context,
        requestBody: { attiCliniciRegoleAccesso: ['N'] } as never,
      }),
    ).rejects.toBeInstanceOf(FseConfigError);
  });
});

describe('getStatus / getStatusByTraceId', () => {
  it('sends only the Bearer token and redacts personal data and SOAP payloads', async () => {
    const sent = intercept('GET', `/status/${encodeURIComponent(WIF)}`, 200, {
      traceID: 'tr',
      spanID: 'sp',
      transactionData: [
        {
          eventType: 'PUBLICATION',
          eventStatus: 'SUCCESS',
          subject: `${REAL_LOOKING_CF}^^^&2.16.840.1.113883.2.9.4.3.2&ISO`,
          identificativoDocumento: `030702.${REAL_LOOKING_CF}.20220325`,
          workflowInstanceId: WIF,
        },
        {
          eventType: 'INI_CREATE_SOAP',
          message: `SOAP_REQUEST:<soap:Envelope><id>${REAL_LOOKING_CF}</id></soap:Envelope>`,
        },
      ],
    });
    const status = await newClient().getStatus(WIF, { subject: context.subject });
    const captured = await sent;
    expect(captured.headers['fse-jwt-signature']).toBeUndefined();
    const { authClaims } = claimsOf(captured);
    expect(authClaims.sub).toBe(context.subject);
    expect(JSON.stringify(status)).not.toContain(REAL_LOOKING_CF);
    expect(status.transactionData[0]?.subject).toBe('[REDACTED:CF]^^^&2.16.840.1.113883.2.9.4.3.2&ISO');
    expect(status.transactionData[1]?.message).toBe('SOAP_REQUEST:[REDACTED:XML]');
  });

  it('queries by trace id', async () => {
    const sent = intercept('GET', '/status/search/3f67b89ba72ed40b', 200, { transactionData: [] });
    await expect(
      newClient().getStatusByTraceId('3f67b89ba72ed40b', { subject: context.subject }),
    ).resolves.toEqual({ httpStatus: 200, transactionData: [] });
    expect((await sent).method).toBe('GET');
  });
});

describe('path parameters', () => {
  const bad = ['../x', 'a/b', '..', '.', 'a b', 'a?b', 'a#b', '%2e%2e', 'a\\b', 'è', 'x'.repeat(257), ''];

  it.each(bad)('refuses idDoc %j without sending anything', async (documentId) => {
    await expect(newClient().delete({ documentId, context })).rejects.toBeInstanceOf(FseConfigError);
  });

  it('refuses a trace id longer than 100 characters', async () => {
    await expect(
      newClient().getStatusByTraceId('a'.repeat(101), { subject: context.subject }),
    ).rejects.toThrow(/traceId exceeds 100/);
  });

  it('never echoes the refused value', async () => {
    const error = await newClient()
      .delete({ documentId: `../${SYNTHETIC_FISCAL_CODE}`, context })
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(SYNTHETIC_FISCAL_CODE);
  });
});

describe('dry-run summaries', () => {
  it('masks tokens, personal claims and fiscal codes in every operation', async () => {
    const client = newClient();
    const ctx: FseRequestContext = { ...context };
    const prepared = [
      await client.preparePublish({ pdf: makeTestPdf(), requestBody: creation, context: ctx }),
      await client.prepareDelete({ documentId: `030702.${REAL_LOOKING_CF}`, context: ctx }),
      await client.prepareUpdateMetadata({ documentId: DOC_ID, requestBody: metadata, context: ctx }),
      await client.prepareStatus({ workflowInstanceId: WIF, subject: ctx.subject }),
    ];
    for (const p of prepared) {
      const summary = JSON.stringify(summarizePreparedRequest(p));
      expect(summary).not.toMatch(/eyJ[\w-]+\./);
      expect(summary).not.toContain(SYNTHETIC_FISCAL_CODE);
      expect(summary).not.toContain(REAL_LOOKING_CF);
    }
    const status = summarizePreparedRequest(prepared[3]!);
    expect(status).not.toHaveProperty('signatureClaims');
    expect(status.headers).toEqual({ authorization: 'Bearer [REDACTED:JWT]', accept: 'application/json' });
  });
});
