/**
 * Redaction of secrets and personal health information (PHI) before anything is logged, printed or put
 * into an error message.
 *
 * The rules are deliberately greedy: a false positive costs a less useful log line, a false negative can be
 * a GDPR art. 9 data breach. Every error message produced by the FSE packages passes through {@link redact}.
 */

/** Placeholder written in place of a compact JWS/JWT. */
export const REDACTED_JWT = '[REDACTED:JWT]';
/** Placeholder written in place of a codice fiscale (Italian fiscal code). */
export const REDACTED_CF = '[REDACTED:CF]';
/** Placeholder written in place of a PEM block (keys, certificates, CSRs). */
export const REDACTED_PEM = '[REDACTED:PEM]';
/** Placeholder written in place of a CDA document or other XML payload. */
export const REDACTED_XML = '[REDACTED:XML]';
/** Placeholder written in place of long base64 blobs (DER certificates, PDFs, hashes are kept). */
export const REDACTED_BASE64 = '[REDACTED:BASE64]';
/** Placeholder written in place of any other secret value. */
export const REDACTED = '[REDACTED]';

const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g;

// Compact JWS: three base64url segments; the header of every JWT starts with `{"` = `eyJ`.
const JWT = /\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/g;

// `Authorization: Bearer xxx` or `bearer=xxx` with any token format.
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Codice fiscale of a natural person: 6 letters, 2 digits, month letter, 2 digits, letter, 3 digits, check
 * letter. In case of "omocodia" digits are replaced by the letters LMNPQRSTUV, so digit positions accept
 * both. Case-insensitive. Matches inside IHE CX values (`CF^^^&2.16.840.1.113883.2.9.4.3.2&ISO`) too.
 * The month position is restricted to the real month letters so that 16-letter XML names such as
 * `ClinicalDocument` are not masked; deliberately invalid fake codes like `PROVAX00X00X000Y` are not
 * masked either, which is harmless.
 */
const OMO = '[0-9LMNPQRSTUV]';
const CODICE_FISCALE = new RegExp(
  `(?<![A-Za-z0-9])[A-Z]{6}${OMO}{2}[ABCDEHLMPRST]${OMO}{2}[A-Z]${OMO}{3}[A-Z](?![A-Za-z0-9])`,
  'gi',
);

// A whole CDA (or any XML document with a prolog) is never useful in a log.
const CDA_DOCUMENT =
  /<(?:[A-Za-z_][\w.-]*:)?ClinicalDocument\b[\s\S]*?(?:<\/(?:[A-Za-z_][\w.-]*:)?ClinicalDocument>|$)/g;
const XML_DOCUMENT = /<\?xml[\s\S]*$/g;

// Base64 runs longer than 200 characters: DER certificates (x5c), embedded PDFs, keys without PEM armour.
const LONG_BASE64 = /[A-Za-z0-9+/]{200,}={0,2}/g;

/**
 * Masks JWTs, bearer tokens, PEM blocks (private keys, certificates), codici fiscali, CDA/XML documents and
 * long base64 blobs in a string.
 *
 * @example
 * redact('person_id=PROVAX00X00X000Y^^^&2.16.840.1.113883.2.9.4.3.2&ISO') // check-secrets: allow
 * // => 'person_id=[REDACTED:CF]^^^&2.16.840.1.113883.2.9.4.3.2&ISO'
 */
export function redact(input: string): string {
  return input
    .replace(PEM_BLOCK, REDACTED_PEM)
    .replace(CDA_DOCUMENT, REDACTED_XML)
    .replace(XML_DOCUMENT, REDACTED_XML)
    .replace(JWT, REDACTED_JWT)
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(LONG_BASE64, REDACTED_BASE64)
    .replace(CODICE_FISCALE, REDACTED_CF);
}

/**
 * Object keys whose values are always replaced, whatever their content. Compared case-insensitively, with
 * `-` and `_` ignored.
 */
const SENSITIVE_KEYS = new Set(
  [
    'authorization',
    'fse-jwt-signature',
    'token',
    'jwt',
    'key',
    'privatekey',
    'passphrase',
    'password',
    'secret',
    'pfx',
    'p12',
    'cert',
    'certificate',
    'ca',
    'person_id',
    'sub',
    'codicefiscale',
    'fiscalcode',
    'cda',
    'cdaxml',
    'xml',
    'pdf',
    'file',
    'body',
  ].map(normalizeKey),
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Deep-redacts a value for structured logging: sensitive keys are replaced entirely, strings go through
 * {@link redact}, binary data is replaced by its length. Cycles are cut.
 */
export function redactValue(value: unknown): unknown {
  return redactInner(value, new WeakSet());
}

function redactInner(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactInner(item, seen));
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(normalizeKey(k)) ? REDACTED : redactInner(v, seen);
  }
  return out;
}
