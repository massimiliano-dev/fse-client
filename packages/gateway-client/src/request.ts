import { redact, REDACTED, REDACTED_JWT } from '@massimiliano-dev/fse-core';
import type { FseApplicationInfo, FseRequestContext } from './claims.js';
import { FseConfigError } from './errors.js';
import type { FseJwtSigner } from './signer.js';
import { createFseTokens, sha256Hex, type FseTokens } from './tokens.js';
import type { ValidationCDAReqDTO } from './types.js';

/** Default maximum PDF size sent to the gateway: 20 MiB. TODO(verify): the gateway's own limit (HTTP 413). */
export const DEFAULT_MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Input of a validation call (`POST /documents/validation`). */
export interface ValidateInput {
  /** PDF with the CDA injected as `cda.xml` attachment (see `@massimiliano-dev/fse-pdf`). */
  pdf: Uint8Array;
  requestBody: ValidationCDAReqDTO;
  context: FseRequestContext;
  /** File name of the multipart part. Default `document.pdf`. Never put patient data in it. */
  fileName?: string;
}

/** Everything needed to send a gateway request, built without any network access. */
export interface PreparedFseRequest {
  operation: 'validate';
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  /** JSON string of the `requestBody` multipart part. */
  requestBodyJson: string;
  file: { name: string; contentType: 'application/pdf'; bytes: Uint8Array; sha256: string };
  tokens: FseTokens;
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

/**
 * Builds the validation request: multipart parts, the two signed JWT headers and the URL. Pure apart from
 * the signer, so it backs both the real call and `fse send --dry-run`.
 *
 * Source: it-fse-support `doc/integrazione-gateway/README.md` §3.1 (Tabella 6) and
 * `openapi/gateway/swagger_gtw.yaml` (`/documents/validation`).
 */
export async function prepareValidationRequest(
  settings: PrepareSettings,
  input: ValidateInput,
): Promise<PreparedFseRequest> {
  const maxPdfBytes = settings.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
  if (!(input.pdf instanceof Uint8Array) || input.pdf.byteLength === 0)
    throw new FseConfigError('The PDF is empty');
  if (input.pdf.byteLength > maxPdfBytes) throw new FseConfigError(`The PDF exceeds ${maxPdfBytes} bytes`);
  if (Buffer.from(input.pdf.subarray(0, 5)).toString('latin1') !== PDF_MAGIC) {
    throw new FseConfigError('The file is not a PDF (missing %PDF- header)');
  }
  const activity = input.requestBody.activity;
  if (activity !== 'VERIFICA' && activity !== 'VALIDATION') {
    throw new FseConfigError('requestBody.activity must be VERIFICA or VALIDATION');
  }
  const fileName = input.fileName ?? 'document.pdf';
  if (!/^[\w.-]{1,100}\.pdf$/i.test(fileName))
    throw new FseConfigError('fileName must be a simple *.pdf name');

  const tokens = await createFseTokens({
    signer: settings.signer,
    audience: settings.baseUrl,
    application: settings.application,
    context: input.context,
    actionId: 'CREATE', // Tabella 62: CREATE "per il servizio di validazione"
    defaultPurposeOfUse: 'TREATMENT', // Tabella 47: TREATMENT "per il servizio di validazione"
    attachment: input.pdf,
    ...(settings.tokenTtlSeconds === undefined ? {} : { ttlSeconds: settings.tokenTtlSeconds }),
    ...(settings.now === undefined ? {} : { now: settings.now }),
  });

  // Defaults: CDA injected as attachment, which is what `@massimiliano-dev/fse-pdf` produces. Omitting
  // `mode` makes the gateway answer with a warning (README §3.1).
  const requestBody: ValidationCDAReqDTO = {
    healthDataFormat: input.requestBody.healthDataFormat ?? 'CDA',
    mode: input.requestBody.mode ?? 'ATTACHMENT',
    activity,
  };

  return {
    operation: 'validate',
    method: 'POST',
    url: `${settings.baseUrl}/documents/validation`,
    headers: {
      authorization: `Bearer ${tokens.authorization}`,
      'fse-jwt-signature': tokens.signature,
      accept: 'application/json',
    },
    requestBodyJson: JSON.stringify(requestBody),
    file: { name: fileName, contentType: 'application/pdf', bytes: input.pdf, sha256: sha256Hex(input.pdf) },
    tokens,
  };
}

/** Claims that identify people: masked in summaries even though they are not secrets. */
const PERSONAL_CLAIMS = new Set(['sub', 'person_id', 'locality']);

/**
 * A summary of a prepared request that is safe to print: tokens replaced, personal claims masked, the
 * PDF reduced to size and hash. Used by `fse send --dry-run`.
 */
export function summarizePreparedRequest(prepared: PreparedFseRequest): Record<string, unknown> {
  const maskClaims = (claims: object) =>
    Object.fromEntries(
      Object.entries(claims).map(([k, v]) => [
        k,
        PERSONAL_CLAIMS.has(k) ? REDACTED : typeof v === 'string' ? redact(v) : v,
      ]),
    );
  return {
    operation: prepared.operation,
    method: prepared.method,
    url: prepared.url,
    headers: {
      authorization: `Bearer ${REDACTED_JWT}`,
      'fse-jwt-signature': REDACTED_JWT,
      accept: prepared.headers.accept,
    },
    multipart: {
      requestBody: JSON.parse(prepared.requestBodyJson) as unknown,
      file: {
        name: prepared.file.name,
        contentType: prepared.file.contentType,
        size: prepared.file.bytes.byteLength,
        sha256: prepared.file.sha256,
      },
    },
    authClaims: maskClaims(prepared.tokens.authClaims),
    signatureClaims: maskClaims(prepared.tokens.signatureClaims),
  };
}
