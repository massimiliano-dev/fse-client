import { redact, REDACTED_XML } from '@massimiliano-dev/fse-core';
import { z } from 'zod';
import type { Dispatcher } from 'undici';
import { FseAuthError, FseGatewayError, FseNotFoundError, FseValidationError } from './errors.js';
import type {
  FseProblemDetails,
  PublicationResDTO,
  ResponseWifDTO,
  StatusCheckDTO,
  TransactionInspectResDTO,
  ValidationResDTO,
} from './types.js';

/** Default maximum size of a gateway response body: 1 MiB. */
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

// Response schemas are lenient on purpose (unknown fields are dropped, not refused) but bounded: string
// limits follow the OpenAPI `maxLength`s, rounded up, and the whole body is capped by maxResponseBytes.
const str = (max: number) => z.string().max(max).optional();

const problemSchema = z.object({
  traceID: str(1000),
  spanID: str(1000),
  type: str(1000),
  title: str(10_000),
  detail: str(1024 * 1024),
  // The guide's own example §11.2.3 has `"status": "400"` (a string), the OpenAPI an int32.
  status: z
    .union([
      z.number().int(),
      z
        .string()
        .regex(/^\d{3}$/)
        .transform(Number),
    ])
    .optional(),
  instance: str(1000),
  workflowInstanceId: str(1000),
  govway_id: str(1000),
});

const validationResSchema = z.object({
  traceID: str(1000),
  spanID: str(1000),
  workflowInstanceId: str(1000),
  warning: str(200_000),
});

const publicationResSchema = validationResSchema.extend({ fhirBundle: z.string().optional() });

const responseWifSchema = validationResSchema;

const statusCheckSchema = z.object({
  eventType: str(1000),
  eventDate: str(1000),
  eventStatus: str(1000),
  message: str(100_000),
  identificativoDocumento: str(1000),
  subject: str(1000),
  subjectRole: str(1000),
  tipoAttivita: str(1000),
  organizzazione: str(1000),
  workflowInstanceId: str(1000),
  traceId: str(1000),
  issuer: str(1000),
  expiringDate: str(1000),
  extra: str(20_000),
});

const transactionInspectSchema = z.object({
  traceID: str(1000),
  spanID: str(1000),
  // OpenAPI: maxItems 1000.
  transactionData: z.array(statusCheckSchema).max(1000).optional(),
});

/** Reads a response body up to `maxBytes`, then aborts: protects against oversized responses. */
export async function readBoundedBody(
  body: Dispatcher.ResponseData['body'],
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.byteLength;
    if (size > maxBytes) {
      body.destroy();
      throw new RangeError(`Gateway response exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Removes `undefined` values and passes every string through {@link redact}. */
function redactStrings<T extends object>(value: T, transform: (s: string) => string = redact): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' ? transform(v) : v;
  }
  return out as T;
}

/** Parses an RFC 7807 body, redacting free-text fields. Returns undefined if the body is not a problem. */
export function parseProblem(text: string): FseProblemDetails | undefined {
  const parsed = problemSchema.safeParse(parseJson(text));
  if (!parsed.success) return undefined;
  return redactStrings(parsed.data as FseProblemDetails);
}

/** Result of a successful validation. */
export interface ValidationResult extends ValidationResDTO {
  /** 200 = VERIFICA succeeded, 201 = VALIDATION succeeded (OpenAPI `validate` responses). */
  httpStatus: 200 | 201;
}

/** Result of a publication, replacement or validate-and-create/replace ("presa in carico"). */
export interface PublicationResult extends PublicationResDTO {
  httpStatus: number;
}

/** Result of a delete or metadata update. */
export interface WorkflowResult extends ResponseWifDTO {
  /** 200 = done synchronously, 202 = taken in charge after an error (guide §2, §6.2, §8.2). */
  httpStatus: number;
}

/** Result of a transaction status query. Free text is redacted (fiscal codes, SOAP/XML payloads). */
export interface TransactionStatusResult extends TransactionInspectResDTO {
  httpStatus: 200;
  transactionData: StatusCheckDTO[];
}

function unexpected(status: number, operation: string): FseGatewayError {
  return new FseGatewayError(`Unexpected ${operation} response body (HTTP ${status})`, { status, operation });
}

/** Maps the gateway response of `POST /documents/validation` to a result or a typed error. */
export function interpretValidationResponse(status: number, text: string): ValidationResult {
  if (status === 200 || status === 201) {
    const parsed = validationResSchema.safeParse(parseJson(text) ?? {});
    if (!parsed.success) throw unexpected(status, 'validate');
    return { httpStatus: status, ...redactStrings(parsed.data as ValidationResDTO) };
  }
  throw errorForStatus(status, parseProblem(text), 'validate');
}

/**
 * Maps the response of a publication (`publish`, `validateAndCreate`, `replace`, `validateAndReplace`).
 * Success is 202 (OpenAPI and guide Tabelle 17/27/37/42). The guide's example headings say "OK 200"
 * (§5.2.1, §7.2.1, §10.2.1, §11.2.1), so 200 is accepted too. TODO(verify).
 */
export function interpretPublicationResponse(
  status: number,
  text: string,
  operation: string,
  options: { includeFhirBundle?: boolean } = {},
): PublicationResult {
  if (status === 202 || status === 200) {
    const parsed = publicationResSchema.safeParse(parseJson(text) ?? {});
    if (!parsed.success) throw unexpected(status, operation);
    const { fhirBundle, ...rest } = parsed.data;
    return {
      httpStatus: status,
      ...redactStrings(rest as PublicationResDTO),
      // Health data: returned only on explicit request, never redacted (it is the caller's own document).
      ...(options.includeFhirBundle && fhirBundle !== undefined ? { fhirBundle } : {}),
    };
  }
  throw errorForStatus(status, parseProblem(text), operation);
}

/**
 * Maps the response of a delete or metadata update. Accepted success codes per operation:
 * delete 200/202 (OpenAPI, guide Tabella 22); metadata 200 (OpenAPI) and 202 (guide Tabella 32);
 * metadata-iti-57 200/202 (OpenAPI); oscuramento a catena 200 (OpenAPI, guide §9.2).
 */
export function interpretWorkflowResponse(
  status: number,
  text: string,
  operation: string,
  success: readonly number[],
): WorkflowResult {
  if (success.includes(status)) {
    const parsed = responseWifSchema.safeParse(parseJson(text) ?? {});
    if (!parsed.success) throw unexpected(status, operation);
    return { httpStatus: status, ...redactStrings(parsed.data as ResponseWifDTO) };
  }
  throw errorForStatus(status, parseProblem(text), operation);
}

/**
 * Status events can carry personal data (`subject`, document ids built from fiscal codes) and, in the
 * validation environment, the whole SOAP request/response exchanged with INI (guide §13). Messages that
 * contain markup are cut at the first `<`; everything goes through {@link redact}.
 */
export function redactStatusText(value: string): string {
  const markup = value.indexOf('<');
  const cut = markup === -1 ? value : `${value.slice(0, markup)}${REDACTED_XML}`;
  return redact(cut);
}

/** Maps the response of `GET /status/{workflowInstanceId}` and `GET /status/search/{traceId}`. */
export function interpretStatusResponse(
  status: number,
  text: string,
  operation: string,
): TransactionStatusResult {
  if (status === 200) {
    const parsed = transactionInspectSchema.safeParse(parseJson(text) ?? {});
    if (!parsed.success) throw unexpected(status, operation);
    const { transactionData, ...rest } = parsed.data;
    return {
      httpStatus: 200,
      ...redactStrings(rest as TransactionInspectResDTO),
      transactionData: (transactionData ?? []).map((event) =>
        redactStrings(event as StatusCheckDTO, redactStatusText),
      ),
    };
  }
  throw errorForStatus(status, parseProblem(text), operation);
}

/** Builds the typed error for a non-success HTTP status. */
export function errorForStatus(
  status: number,
  problem: FseProblemDetails | undefined,
  operation: string,
): FseGatewayError {
  const what = [problem?.type, problem?.title].filter(Boolean).join(' ');
  const suffix = what ? `: ${what}` : '';
  const init = { status, operation, ...(problem ? { problem } : {}) };
  if (status === 401 || status === 403) {
    return new FseAuthError(`Gateway refused the credentials (HTTP ${status})${suffix}`, init);
  }
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return new FseValidationError(`Gateway rejected the request (HTTP ${status})${suffix}`, init);
  }
  if (status === 404) return new FseNotFoundError(`Gateway: not found (HTTP 404)${suffix}`, init);
  return new FseGatewayError(`Gateway error (HTTP ${status})${suffix}`, init);
}
