import { describe, expect, it } from 'vitest';
import {
  FseError,
  redact,
  REDACTED,
  REDACTED_BASE64,
  REDACTED_CF,
  REDACTED_JWT,
  REDACTED_PEM,
  REDACTED_XML,
  redactValue,
} from '../src/index.js';

// Built at runtime so that secret scanners do not flag the test sources.
const CF = ['RSSMRA', '85T10A562S'].join(''); // textbook example code, not a real person
const OMOCODIC_CF = ['RSSMRA', 'URTMLARSVS'].join('');
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const JWT = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ sub: CF, person_id: CF })}.${'s'.repeat(40)}`;
const PEM = [
  '-----BEGIN',
  'PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END',
  'PRIVATE KEY-----',
].join(' ');

describe('redact', () => {
  it('masks a codice fiscale, including inside IHE CX values', () => {
    expect(redact(`patient ${CF}`)).toBe(`patient ${REDACTED_CF}`);
    expect(redact(`${CF}^^^&2.16.840.1.113883.2.9.4.3.2&ISO`)).toBe(
      `${REDACTED_CF}^^^&2.16.840.1.113883.2.9.4.3.2&ISO`,
    );
    expect(redact(`'${CF.toLowerCase()}' is not valid`)).toBe(`'${REDACTED_CF}' is not valid`);
  });

  it('masks a codice fiscale followed by stray letters (typos quoted by schematron messages)', () => {
    expect(redact(`codice fiscale '${CF}x' cittadino`)).toBe(`codice fiscale '${REDACTED_CF}x' cittadino`);
  });

  it('masks codici fiscali with omocodia substitutions', () => {
    expect(redact(OMOCODIC_CF)).toBe(REDACTED_CF);
  });

  it('does not mask XML element names that look like fiscal codes by length', () => {
    expect(redact("Element '{urn:hl7-org:v3}ClinicalDocument': missing child")).toContain('ClinicalDocument');
  });

  it('masks JWTs and bearer tokens', () => {
    const out = redact(`FSE-JWT-Signature: ${JWT}`);
    expect(out).toBe(`FSE-JWT-Signature: ${REDACTED_JWT}`);
    expect(out).not.toContain(CF);
    expect(redact('Authorization: Bearer abc.def-ghi')).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it('masks PEM blocks, also when truncated', () => {
    expect(redact(`key: ${PEM} end`)).toBe(`key: ${REDACTED_PEM} end`);
    expect(redact('-----BEGIN RSA PRIVATE KEY-----\nMIIabc')).toBe(REDACTED_PEM); // check-secrets: allow (truncated fake)
  });

  it('masks CDA bodies and XML documents', () => {
    const cda = `<ClinicalDocument xmlns="urn:hl7-org:v3"><id extension="${CF}"/></ClinicalDocument>`;
    expect(redact(`payload ${cda} done`)).toBe(`payload ${REDACTED_XML} done`);
    expect(redact('<?xml version="1.0"?><foo>bar</foo>')).toBe(REDACTED_XML);
  });

  it('masks long base64 blobs but keeps SHA-256 hex digests', () => {
    expect(redact('A'.repeat(300))).toBe(REDACTED_BASE64);
    const hash = 'd04f5f5d34c7bbb77e27fba4edb2c49d16ca90193d89a47117e892387c7ee466';
    expect(redact(hash)).toBe(hash);
  });
});

describe('redactValue', () => {
  it('replaces sensitive keys and redacts nested strings', () => {
    const cyclic: Record<string, unknown> = { note: `cf ${CF}` };
    cyclic.self = cyclic;
    const out = redactValue({
      headers: { Authorization: `Bearer ${JWT}`, 'FSE-JWT-Signature': JWT, accept: 'application/json' },
      claims: { person_id: CF, sub: CF, aud: 'https://example.test' },
      tls: { key: PEM, passphrase: 'secret' },
      pdf: new Uint8Array(10),
      nested: cyclic,
      buffer: new Uint8Array(4),
    });
    expect(out).toEqual({
      headers: { Authorization: REDACTED, 'FSE-JWT-Signature': REDACTED, accept: 'application/json' },
      claims: { person_id: REDACTED, sub: REDACTED, aud: 'https://example.test' },
      tls: { key: REDACTED, passphrase: REDACTED },
      pdf: REDACTED,
      nested: { note: `cf ${REDACTED_CF}`, self: '[Circular]' },
      buffer: '[binary 4 bytes]',
    });
  });
});

describe('FseError', () => {
  it('redacts its message and sanitises the cause', () => {
    const cause = Object.assign(new Error(`socket closed while sending ${JWT}`), {
      code: 'ECONNRESET',
      token: JWT,
    });
    const error = new FseError(`failed for ${CF}`, { cause });
    expect(error.message).toBe(`failed for ${REDACTED_CF}`);
    const safeCause = error.cause as Error & { code?: string; token?: string };
    expect(safeCause.message).not.toContain('eyJ');
    expect(safeCause.code).toBe('ECONNRESET');
    expect(safeCause.token).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(CF);
  });
});
