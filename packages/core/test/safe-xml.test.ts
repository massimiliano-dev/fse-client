import { describe, expect, it } from 'vitest';
import { assertSafeXml, UnsafeXmlError } from '../src/index.js';

const ok = '<?xml version="1.0" encoding="UTF-8"?><ClinicalDocument xmlns="urn:hl7-org:v3"/>';

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof UnsafeXmlError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('assertSafeXml', () => {
  it('accepts a plain UTF-8 document and strips the BOM', () => {
    expect(assertSafeXml(ok)).toBe(ok);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(ok)]);
    expect(assertSafeXml(withBom)).toBe(ok);
  });

  it('rejects DOCTYPE and ENTITY declarations (XXE, entity expansion)', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>';
    expect(reasonOf(() => assertSafeXml(xxe))).toBe('doctype');
    expect(reasonOf(() => assertSafeXml('<!doctype r><r/>'))).toBe('doctype');
    expect(reasonOf(() => assertSafeXml('<r><!ENTITY x "y"></r>'))).toBe('doctype');
  });

  it('never echoes the document in the error', () => {
    try {
      assertSafeXml('<!DOCTYPE r [<!ENTITY secret "TOP-SECRET-VALUE">]><r>&secret;</r>');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('TOP-SECRET-VALUE');
    }
  });

  it('enforces the size limit for strings and bytes', () => {
    expect(reasonOf(() => assertSafeXml('<r>' + 'x'.repeat(100) + '</r>', { maxBytes: 50 }))).toBe(
      'too-large',
    );
    expect(reasonOf(() => assertSafeXml(new Uint8Array(51), { maxBytes: 50 }))).toBe('too-large');
    // multi-byte characters count in bytes, not UTF-16 units
    expect(reasonOf(() => assertSafeXml(`<r>${'è'.repeat(20)}</r>`, { maxBytes: 40 }))).toBe('too-large');
  });

  it('accepts only UTF-8', () => {
    expect(reasonOf(() => assertSafeXml(new Uint8Array([0xff, 0xfe, 0x3c, 0x00])))).toBe('encoding');
    expect(reasonOf(() => assertSafeXml(new Uint8Array([0x3c, 0x72, 0xc3, 0x28, 0x3e])))).toBe('encoding');
    expect(reasonOf(() => assertSafeXml('<?xml version="1.0" encoding="ISO-8859-1"?><r/>'))).toBe('encoding');
    expect(reasonOf(() => assertSafeXml('<?xml version="1.0" encoding="UTF-7"?><r/>'))).toBe('encoding');
    expect(assertSafeXml('<?xml version="1.0" encoding="utf-8"?><r/>')).toContain('<r/>');
  });
});
