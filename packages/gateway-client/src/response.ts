import { redact } from '@massimiliano-dev/fse-core';
import { z } from 'zod';
import type { Dispatcher } from 'undici';
import { FseAuthError, FseGatewayError, FseValidationError } from './errors.js';
import type { FseProblemDetails, ValidationResDTO } from './types.js';

/** Default maximum size of a gateway response body: 1 MiB. */
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

const optionalString = z
  .string()
  .max(64 * 1024)
  .optional();

const problemSchema = z.object({
  traceID: optionalString,
  spanID: optionalString,
  type: optionalString,
  title: optionalString,
  detail: optionalString,
  status: z.number().int().optional(),
  instance: optionalString,
  workflowInstanceId: optionalString,
});

const validationResSchema = z.object({
  traceID: optionalString,
  spanID: optionalString,
  workflowInstanceId: optionalString,
  warning: optionalString,
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

/** Parses an RFC 7807 body, redacting free-text fields. Returns undefined if the body is not a problem. */
export function parseProblem(text: string): FseProblemDetails | undefined {
  const parsed = problemSchema.safeParse(parseJson(text));
  if (!parsed.success) return undefined;
  const p = parsed.data;
  const out: FseProblemDetails = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    (out as Record<string, unknown>)[k] = typeof v === 'string' ? redact(v) : v;
  }
  return out;
}

/** Result of a successful validation. */
export interface ValidationResult extends ValidationResDTO {
  /** 200 = VERIFICA succeeded, 201 = VALIDATION succeeded (OpenAPI `validate` responses). */
  httpStatus: 200 | 201;
}

/** Maps the gateway response of `POST /documents/validation` to a result or a typed error. */
export function interpretValidationResponse(status: number, text: string): ValidationResult {
  if (status === 200 || status === 201) {
    const parsed = validationResSchema.safeParse(parseJson(text) ?? {});
    if (!parsed.success) {
      throw new FseGatewayError(`Unexpected validation response body (HTTP ${status})`, {
        status,
        operation: 'validate',
      });
    }
    const dto = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as ValidationResDTO;
    if (dto.warning !== undefined) dto.warning = redact(dto.warning);
    return { httpStatus: status, ...dto };
  }
  throw errorForStatus(status, parseProblem(text), 'validate');
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
  return new FseGatewayError(`Gateway error (HTTP ${status})${suffix}`, init);
}
