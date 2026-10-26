import { UnsafeXmlError } from './errors.js';

/** Default maximum size of an XML document accepted by the FSE packages: 10 MiB. */
export const DEFAULT_MAX_XML_BYTES = 10 * 1024 * 1024;

/** Options for {@link assertSafeXml}. */
export interface SafeXmlOptions {
  /** Maximum size in bytes (UTF-8). Default {@link DEFAULT_MAX_XML_BYTES}. */
  maxBytes?: number;
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
const encoder = new TextEncoder();

/**
 * Checks that an XML document is safe to hand to an XML parser and returns it as a string (UTF-8 BOM
 * removed).
 *
 * CDA2 documents never need a DTD, so the check fails closed:
 * - any `<!DOCTYPE` or `<!ENTITY` declaration is rejected. This blocks XXE (external entities reading
 *   local files or the network) and entity-expansion bombs ("billion laughs") before parsing. It matters:
 *   the WebAssembly libxml2 used for XSD validation expands external entities from its virtual file
 *   system even without `--noent`;
 * - the input must be valid UTF-8 and, if it declares an encoding, it must be UTF-8. Other encodings
 *   (UTF-16, UTF-7, ISO-2022…) could hide a `<!DOCTYPE` from this byte-level check;
 * - the size is capped (default 10 MiB) to bound memory use.
 *
 * Error messages never include the document content.
 *
 * @throws {UnsafeXmlError} if any rule is violated.
 */
export function assertSafeXml(input: string | Uint8Array, options: SafeXmlOptions = {}): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_XML_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('maxBytes must be a positive integer');
  }

  let text: string;
  if (typeof input === 'string') {
    // Cheap upper bound first, so a huge string is rejected without encoding it.
    if (input.length > maxBytes)
      throw new UnsafeXmlError('too-large', `XML document exceeds ${maxBytes} bytes`);
    if (encoder.encode(input).byteLength > maxBytes) {
      throw new UnsafeXmlError('too-large', `XML document exceeds ${maxBytes} bytes`);
    }
    text = input;
  } else {
    if (input.byteLength > maxBytes) {
      throw new UnsafeXmlError('too-large', `XML document exceeds ${maxBytes} bytes`);
    }
    if (
      input.byteLength >= 2 &&
      ((input[0] === 0xfe && input[1] === 0xff) || (input[0] === 0xff && input[1] === 0xfe))
    ) {
      throw new UnsafeXmlError('encoding', 'XML document is UTF-16 encoded; only UTF-8 is accepted');
    }
    try {
      text = decoder.decode(input);
    } catch {
      throw new UnsafeXmlError('encoding', 'XML document is not valid UTF-8');
    }
  }

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('\u0000')) {
    throw new UnsafeXmlError('encoding', 'XML document contains NUL characters (not UTF-8 text)');
  }

  const declaration = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']([^"']*)["']/i.exec(text);
  if (declaration && !/^utf-?8$/i.test(declaration[1] ?? '')) {
    throw new UnsafeXmlError('encoding', 'XML declaration specifies an encoding other than UTF-8');
  }

  if (/<!DOCTYPE/i.test(text)) {
    throw new UnsafeXmlError('doctype', 'XML document contains a DOCTYPE declaration, which is not allowed');
  }
  if (/<!ENTITY/i.test(text)) {
    throw new UnsafeXmlError('doctype', 'XML document contains an ENTITY declaration, which is not allowed');
  }

  return text;
}
