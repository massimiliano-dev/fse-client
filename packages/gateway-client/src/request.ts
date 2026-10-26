import { redact, redactValue, REDACTED, REDACTED_JWT } from '@massimiliano-dev/fse-core';
import type { z } from 'zod';
import {
  FSE_OPERATION_CLAIMS,
  type FseApplicationInfo,
  type FseRequestContext,
  type FseSignedOperation,
} from './claims.js';
import { CLASS_CODE_BY_LOINC } from './enums.js';
import { FseConfigError } from './errors.js';
import { buildGatewayUrl, encodePathParam } from './path.js';
import {
  parseRequestBody,
  publicationCreationReqSchema,
  publicationUpdateReqSchema,
  updateMetadataOscuramentoReqSchema,
  updateMetadataReqSchema,
  validateAndCreateSchema,
  validateAndReplaceSchema,
  validationCdaReqSchema,
} from './schemas.js';
import type { FseJwtSigner } from './signer.js';
import {
  createFseAuthToken,
  createFseTokens,
  sha256Hex,
  type FseAuthToken,
  type FseTokens,
} from './tokens.js';
import type {
  PublicationCreationReqDTO,
  PublicationUpdateReqDTO,
  TipoDocumentoLivAlto,
  UpdateMetadataOscuramentoReqDTO,
  UpdateMetadataReqDTO,
  ValidateAndCreateDTO,
  ValidateAndReplaceDTO,
  ValidationCDAReqDTO,
} from './types.js';

/** Default maximum PDF size sent to the gateway: 20 MiB. TODO(verify): the gateway's own limit (HTTP 413). */
export const DEFAULT_MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Every gateway operation implemented by this client. */
export type FseOperation = FseSignedOperation | 'getStatus' | 'getStatusByTraceId';

/** Common fields of the operations that upload a PDF (multipart `file` + `requestBody`). */
export interface DocumentUploadInput<TBody> {
  /** PDF with the CDA injected as `cda.xml` attachment (see `@massimiliano-dev/fse-pdf`). */
  pdf: Uint8Array;
  requestBody: TBody;
  context: FseRequestContext;
  /** File name of the multipart part. Default `document.pdf`. Never put patient data in it. */
  fileName?: string;
}

/** Input of a validation call (`POST /documents/validation`). */
export type ValidateInput = DocumentUploadInput<ValidationCDAReqDTO>;

/** Input of `POST /documents` (publication / creation). */
export interface PublishInput extends DocumentUploadInput<PublicationCreationReqDTO> {
  /** Return the FHIR bundle of the 202 response (health data). Default false: it is dropped. */
  includeFhirBundle?: boolean;
}

/** Input of `POST /documents/validate-and-create`. */
export interface ValidateAndCreateInput extends DocumentUploadInput<ValidateAndCreateDTO> {
  includeFhirBundle?: boolean;
}

/** Input of `PUT /documents/{idDoc}` (replacement). */
export interface ReplaceInput extends DocumentUploadInput<PublicationUpdateReqDTO> {
  /** OID of the document to replace (`idDoc`, XDSDocumentEntry.uniqueId used at creation). */
  documentId: string;
  includeFhirBundle?: boolean;
}

/** Input of `PUT /documents/validate-and-replace/{idDoc}`. */
export interface ValidateAndReplaceInput extends DocumentUploadInput<ValidateAndReplaceDTO> {
  documentId: string;
  includeFhirBundle?: boolean;
}

/** Input of `DELETE /documents/{idDoc}`. `context.resourceHl7Type` is optional here (guide Tabella 55). */
export interface DeleteInput {
  documentId: string;
  context: FseRequestContext;
}

/** Input of `PUT /documents/{idDoc}/metadata` and `PUT /documents/{idDoc}/metadata-iti-57`. */
export interface UpdateMetadataInput {
  documentId: string;
  requestBody: UpdateMetadataReqDTO;
  context: FseRequestContext;
}

/**
 * Input of `PUT /documents/{idDoc}/metadata-oscuramento-catena`. The body is fixed by the guide (§9:
 * `{"attiCliniciRegoleAccesso": ["P99"]}`) and sent by default. `subject_role` (NOR) and `locality`
 * (`------`) are fixed by the guide and replace the context values.
 */
export interface UpdateMetadataOscuramentoInput {
  documentId: string;
  context: FseRequestContext;
  requestBody?: UpdateMetadataOscuramentoReqDTO;
}

/** Input of the transaction status services (Bearer token only). */
export interface StatusQueryInput {
  /** `sub` of the Bearer token: operator fiscal code (or organisation VAT number), IHE CX format. */
  subject: string;
}

/** The body of a prepared request. */
export type PreparedBody =
  | {
      kind: 'multipart';
      /** JSON string of the `requestBody` multipart part. */
      requestBodyJson: string;
      file: { name: string; contentType: 'application/pdf'; bytes: Uint8Array; sha256: string };
    }
  | { kind: 'json'; json: string }
  | { kind: 'none' };

/** Everything needed to send a gateway request, built without any network access. */
export interface PreparedFseRequest {
  operation: FseOperation;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body: PreparedBody;
  /** Both tokens for document operations; the Bearer token alone for the status services. */
  tokens: FseTokens | FseAuthToken;
}

/** Shared settings for building requests. */
export interface PrepareSettings {
  baseUrl: string;
  signer: FseJwtSigner;
  application: FseApplicationInfo;
  tokenTtlSeconds?: number;
  maxPdfBytes?: number;
  now?: () => Date;
}

const PDF_MAGIC = '%PDF-';

function checkPdf(settings: PrepareSettings, pdf: unknown): Uint8Array {
  const maxPdfBytes = settings.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
  if (!(pdf instanceof Uint8Array) || pdf.byteLength === 0) throw new FseConfigError('The PDF is empty');
  if (pdf.byteLength > maxPdfBytes) throw new FseConfigError(`The PDF exceeds ${maxPdfBytes} bytes`);
  if (Buffer.from(pdf.subarray(0, 5)).toString('latin1') !== PDF_MAGIC) {
    throw new FseConfigError('The file is not a PDF (missing %PDF- header)');
  }
  return pdf;
}

function checkFileName(fileName: string | undefined): string {
  const name = fileName ?? 'document.pdf';
  if (!/^[\w.-]{1,100}\.pdf$/i.test(name)) throw new FseConfigError('fileName must be a simple *.pdf name');
  return name;
}

/**
 * Checks the correlation between the LOINC code in `resource_hl7_type` and `tipoDocumentoLivAlto` that the
 * gateway enforces for creation, replacement and metadata update (guide §16.4, §16.4.1). Codes that are
 * not in the official table, or a `resource_hl7_type` not in the documented `('code^^codeSystem')` form,
 * are left to the gateway.
 *
 * @throws {FseConfigError}
 */
export function checkClassCodeCorrelation(
  resourceHl7Type: string | undefined,
  tipoDocumentoLivAlto: TipoDocumentoLivAlto,
): void {
  const match = /^\('([^'^]+)\^\^[^']*'\)$/.exec(resourceHl7Type ?? '');
  const expected = match ? CLASS_CODE_BY_LOINC[match[1] ?? ''] : undefined;
  if (expected !== undefined && expected !== tipoDocumentoLivAlto) {
    throw new FseConfigError(
      `tipoDocumentoLivAlto ${tipoDocumentoLivAlto} does not match the document type (expected ${expected}, guide §16.4)`,
    );
  }
}

function signedTokens(
  settings: PrepareSettings,
  operation: FseSignedOperation,
  context: FseRequestContext,
  attachment: Uint8Array | undefined,
): Promise<FseTokens> {
  const policy = FSE_OPERATION_CLAIMS[operation];
  if (typeof context !== 'object' || context === null) throw new FseConfigError('context is required');
  return createFseTokens({
    signer: settings.signer,
    audience: settings.baseUrl,
    application: settings.application,
    context,
    actionId: policy.actionId,
    defaultPurposeOfUse: policy.defaultPurposeOfUse,
    allowedPurposesOfUse: policy.allowedPurposesOfUse,
    resourceHl7Type: policy.resourceHl7Type,
    ...(policy.fixedClaims ? { fixedClaims: policy.fixedClaims } : {}),
    ...(policy.attachmentHash === 'required' && attachment ? { attachment } : {}),
    ...(settings.tokenTtlSeconds === undefined ? {} : { ttlSeconds: settings.tokenTtlSeconds }),
    ...(settings.now === undefined ? {} : { now: settings.now }),
  });
}

function signedHeaders(tokens: FseTokens, contentType?: string): Record<string, string> {
  return {
    authorization: `Bearer ${tokens.authorization}`,
    'fse-jwt-signature': tokens.signature,
    accept: 'application/json',
    ...(contentType ? { 'content-type': contentType } : {}),
  };
}

/** Builds a multipart document upload: checks, body defaults, tokens. */
async function prepareUpload<TBody extends { mode?: string; healthDataFormat?: string }>(
  settings: PrepareSettings,
  operation: FseSignedOperation,
  method: 'POST' | 'PUT',
  path: string,
  input: DocumentUploadInput<unknown>,
  schema: z.ZodType<TBody>,
  label: string,
  check?: (body: TBody) => void,
): Promise<PreparedFseRequest> {
  const pdf = checkPdf(settings, input.pdf);
  const fileName = checkFileName(input.fileName);
  const parsed = parseRequestBody(schema, input.requestBody, label);
  check?.(parsed);
  // Defaults: CDA injected as attachment, which is what `@massimiliano-dev/fse-pdf` produces. Omitting
  // `mode` makes the gateway answer with a warning (guide §3.1, §7.1, §16.2).
  const requestBody = {
    healthDataFormat: 'CDA',
    mode: 'ATTACHMENT',
    ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)),
  };
  const url = buildGatewayUrl(settings.baseUrl, path);
  const tokens = await signedTokens(settings, operation, input.context, pdf);
  return {
    operation,
    method,
    url,
    headers: signedHeaders(tokens),
    body: {
      kind: 'multipart',
      requestBodyJson: JSON.stringify(requestBody),
      file: { name: fileName, contentType: 'application/pdf', bytes: pdf, sha256: sha256Hex(pdf) },
    },
    tokens,
  };
}

/**
 * `POST /documents/validation` (guide §3.1, Tabella 6). Claims: `action_id` CREATE, `purpose_of_use`
 * TREATMENT, `attachment_hash`.
 */
export function prepareValidationRequest(
  settings: PrepareSettings,
  input: ValidateInput,
): Promise<PreparedFseRequest> {
  return prepareUpload(
    settings,
    'validate',
    'POST',
    '/documents/validation',
    input,
    validationCdaReqSchema,
    'validation requestBody',
  );
}

/**
 * `POST /documents` (guide §5.1, Tabella 16; OpenAPI `create_1`). Claims: `action_id` CREATE,
 * `purpose_of_use` TREATMENT, `attachment_hash` (required, Tabella 55).
 */
export function preparePublicationRequest(
  settings: PrepareSettings,
  input: PublishInput,
): Promise<PreparedFseRequest> {
  return prepareUpload(
    settings,
    'publish',
    'POST',
    '/documents',
    input,
    publicationCreationReqSchema,
    'publication requestBody',
    (body) => checkClassCodeCorrelation(input.context?.resourceHl7Type, body.tipoDocumentoLivAlto),
  );
}

/** `POST /documents/validate-and-create` (guide §10.1, Tabella 36; OpenAPI `validateAndCreate`). */
export function prepareValidateAndCreateRequest(
  settings: PrepareSettings,
  input: ValidateAndCreateInput,
): Promise<PreparedFseRequest> {
  return prepareUpload(
    settings,
    'validateAndCreate',
    'POST',
    '/documents/validate-and-create',
    input,
    validateAndCreateSchema,
    'validate-and-create requestBody',
    (body) => checkClassCodeCorrelation(input.context?.resourceHl7Type, body.tipoDocumentoLivAlto),
  );
}

/**
 * `PUT /documents/{idDoc}` (guide §7.1, Tabella 26; OpenAPI `replace_1`). Claims: `action_id` UPDATE,
 * `purpose_of_use` UPDATE, `attachment_hash` (required, Tabella 55).
 */
export function prepareReplaceRequest(
  settings: PrepareSettings,
  input: ReplaceInput,
): Promise<PreparedFseRequest> {
  const idDoc = encodePathParam('idDoc', input.documentId);
  return prepareUpload(
    settings,
    'replace',
    'PUT',
    `/documents/${idDoc}`,
    input,
    publicationUpdateReqSchema,
    'replace requestBody',
    (body) => checkClassCodeCorrelation(input.context?.resourceHl7Type, body.tipoDocumentoLivAlto),
  );
}

/** `PUT /documents/validate-and-replace/{idDoc}` (guide §11.1, Tabella 41; OpenAPI `validateAndReplace`). */
export function prepareValidateAndReplaceRequest(
  settings: PrepareSettings,
  input: ValidateAndReplaceInput,
): Promise<PreparedFseRequest> {
  const idDoc = encodePathParam('idDoc', input.documentId);
  return prepareUpload(
    settings,
    'validateAndReplace',
    'PUT',
    `/documents/validate-and-replace/${idDoc}`,
    input,
    validateAndReplaceSchema,
    'validate-and-replace requestBody',
    (body) => checkClassCodeCorrelation(input.context?.resourceHl7Type, body.tipoDocumentoLivAlto),
  );
}

/**
 * `DELETE /documents/{idDoc}` (guide §6.1, Tabella 21). No body. Claims: `action_id` DELETE,
 * `purpose_of_use` UPDATE, no `attachment_hash`, `resource_hl7_type` only if given.
 */
export async function prepareDeleteRequest(
  settings: PrepareSettings,
  input: DeleteInput,
): Promise<PreparedFseRequest> {
  const url = buildGatewayUrl(settings.baseUrl, `/documents/${encodePathParam('idDoc', input.documentId)}`);
  const tokens = await signedTokens(settings, 'delete', input.context, undefined);
  return {
    operation: 'delete',
    method: 'DELETE',
    url,
    headers: signedHeaders(tokens),
    body: { kind: 'none' },
    tokens,
  };
}

/**
 * `PUT /documents/{idDoc}/metadata` or `/metadata-iti-57` (guide §8.1, Tabella 31). JSON body. Claims:
 * `action_id` UPDATE, `purpose_of_use` UPDATE (or ACCESS UPDATE), no `attachment_hash`.
 */
export async function prepareUpdateMetadataRequest(
  settings: PrepareSettings,
  input: UpdateMetadataInput,
  variant: 'metadata' | 'metadata-iti-57' = 'metadata',
): Promise<PreparedFseRequest> {
  const operation = variant === 'metadata' ? 'updateMetadata' : 'updateMetadataIti57';
  const url = buildGatewayUrl(
    settings.baseUrl,
    `/documents/${encodePathParam('idDoc', input.documentId)}/${variant}`,
  );
  const body = parseRequestBody(updateMetadataReqSchema, input.requestBody, 'metadata requestBody');
  checkClassCodeCorrelation(input.context?.resourceHl7Type, body.tipoDocumentoLivAlto);
  const tokens = await signedTokens(settings, operation, input.context, undefined);
  return {
    operation,
    method: 'PUT',
    url,
    headers: signedHeaders(tokens, 'application/json'),
    body: { kind: 'json', json: JSON.stringify(body) },
    tokens,
  };
}

/**
 * `PUT /documents/{idDoc}/metadata-oscuramento-catena` (guide §9). Claims fixed by the guide:
 * `purpose_of_use` SYSADMIN, `action_id` UPDATE, `subject_role` NOR, `locality` `------`,
 * `resource_hl7_type` optional. Not available in production (guide §2, Tabella 4).
 */
export async function prepareUpdateMetadataOscuramentoRequest(
  settings: PrepareSettings,
  input: UpdateMetadataOscuramentoInput,
): Promise<PreparedFseRequest> {
  const url = buildGatewayUrl(
    settings.baseUrl,
    `/documents/${encodePathParam('idDoc', input.documentId)}/metadata-oscuramento-catena`,
  );
  const body = parseRequestBody(
    updateMetadataOscuramentoReqSchema,
    input.requestBody ?? { attiCliniciRegoleAccesso: ['P99'] },
    'oscuramento requestBody',
  );
  const tokens = await signedTokens(settings, 'updateMetadataOscuramentoCatena', input.context, undefined);
  return {
    operation: 'updateMetadataOscuramentoCatena',
    method: 'PUT',
    url,
    headers: signedHeaders(tokens, 'application/json'),
    body: { kind: 'json', json: JSON.stringify(body) },
    tokens,
  };
}

/**
 * `GET /status/{workflowInstanceId}` (guide §13.1, Tabelle 45-46) or `GET /status/search/{traceId}`
 * (guide §14.1, Tabelle 50-51). The guide lists only `Authorization: Bearer` and `Accept` as headers, so
 * no `FSE-JWT-Signature` is sent (the OpenAPI declares no per-operation security for these paths).
 */
export async function prepareStatusRequest(
  settings: PrepareSettings,
  input: StatusQueryInput & ({ workflowInstanceId: string } | { traceId: string }),
): Promise<PreparedFseRequest> {
  const byTrace = 'traceId' in input;
  const path = byTrace
    ? `/status/search/${encodePathParam('traceId', input.traceId)}`
    : `/status/${encodePathParam('workflowInstanceId', input.workflowInstanceId)}`;
  const url = buildGatewayUrl(settings.baseUrl, path);
  const token = await createFseAuthToken({
    signer: settings.signer,
    audience: settings.baseUrl,
    subject: input.subject,
    ...(settings.tokenTtlSeconds === undefined ? {} : { ttlSeconds: settings.tokenTtlSeconds }),
    ...(settings.now === undefined ? {} : { now: settings.now }),
  });
  return {
    operation: byTrace ? 'getStatusByTraceId' : 'getStatus',
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token.authorization}`, accept: 'application/json' },
    body: { kind: 'none' },
    tokens: token,
  };
}

/** Claims that identify people: masked in summaries even though they are not secrets. */
const PERSONAL_CLAIMS = new Set(['sub', 'person_id', 'locality']);

function maskClaims(claims: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(claims).map(([k, v]) => [
      k,
      PERSONAL_CLAIMS.has(k) ? REDACTED : typeof v === 'string' ? redact(v) : v,
    ]),
  );
}

/**
 * A summary of a prepared request that is safe to print: tokens replaced, personal claims masked, the PDF
 * reduced to size and hash, fiscal codes masked anywhere in the URL and body. Used by `--dry-run`.
 */
export function summarizePreparedRequest(prepared: PreparedFseRequest): Record<string, unknown> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(prepared.headers)) {
    headers[k] =
      k === 'authorization' ? `Bearer ${REDACTED_JWT}` : k === 'fse-jwt-signature' ? REDACTED_JWT : v;
  }
  const body = prepared.body;
  const summaryBody =
    body.kind === 'multipart'
      ? {
          multipart: {
            requestBody: redactValue(JSON.parse(body.requestBodyJson) as unknown),
            file: {
              name: body.file.name,
              contentType: body.file.contentType,
              size: body.file.bytes.byteLength,
              sha256: body.file.sha256,
            },
          },
        }
      : body.kind === 'json'
        ? { json: redactValue(JSON.parse(body.json) as unknown) }
        : {};
  const tokens = prepared.tokens;
  return {
    operation: prepared.operation,
    method: prepared.method,
    url: redact(prepared.url),
    headers,
    ...summaryBody,
    authClaims: maskClaims(tokens.authClaims),
    ...('signatureClaims' in tokens ? { signatureClaims: maskClaims(tokens.signatureClaims) } : {}),
  };
}
