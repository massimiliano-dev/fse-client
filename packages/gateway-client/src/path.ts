import { FseConfigError } from './errors.js';

/** Limits of the path parameters, from it-fse-support `openapi/gateway/swagger_gtw.yaml`. */
export const PATH_PARAM_LIMITS = {
  /** `idDoc`: `minLength: 1`, `maxLength: 256` (all `/documents/{idDoc}…` paths). */
  idDoc: 256,
  /** `workflowInstanceId`: `maxLength: 256` (`GET /status/{workflowInstanceId}`; the OpenAPI says `minLength: 0`). */
  workflowInstanceId: 256,
  /** `traceId`: `minLength: 1`, `maxLength: 100` (`GET /status/search/{traceId}`). */
  traceId: 100,
} as const;

/** Name of a path parameter. */
export type FsePathParam = keyof typeof PATH_PARAM_LIMITS;

/**
 * Checks a path parameter and returns it percent-encoded for a single path segment.
 *
 * Accepted: 1..max printable ASCII characters (0x21-0x7E) except `/`, `\`, `?`, `#` and `%`, and not `.` or
 * `..`. That covers the identifiers documented by the guide (OIDs such as
 * `2.16.840.1.113883.2.9.2.120.4.4^290700`, workflow ids such as `…^^^^urn:ihe:iti:xdw:2013:workflowInstanceId`,
 * hex trace ids) and rules out path traversal, query/fragment injection, double encoding and header
 * splitting. The value never appears in the error message.
 *
 * Encoding uses `encodeURIComponent`, so `^` is sent as `%5E` and `:` as `%3A` (RFC 3986 does not allow a
 * raw `^` in a path). TODO(verify): the guide's curl examples (§13.1.1) show raw `^` characters; servlet
 * containers decode both forms the same way.
 *
 * @throws {FseConfigError}
 */
export function encodePathParam(name: FsePathParam, value: unknown): string {
  const max = PATH_PARAM_LIMITS[name];
  if (typeof value !== 'string' || value.length === 0) throw new FseConfigError(`${name} is required`);
  if (value.length > max) throw new FseConfigError(`${name} exceeds ${max} characters`);
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw new FseConfigError(`${name} must contain only printable ASCII characters without spaces`);
  }
  if (/[/\\?#%]/.test(value) || value === '.' || value === '..') {
    throw new FseConfigError(`${name} contains characters that are not allowed in a path segment`);
  }
  return encodeURIComponent(value);
}

/**
 * Joins the base URL and path segments, then checks that URL normalisation did not move the request
 * outside the gateway base path (defence in depth on top of {@link encodePathParam}).
 */
export function buildGatewayUrl(baseUrl: string, path: string): string {
  const url = new URL(`${baseUrl}${path}`);
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || url.pathname !== `${base.pathname}${path}` || url.search || url.hash) {
    throw new FseConfigError('Refusing a gateway URL that escapes the base path');
  }
  return url.toString();
}
