/**
 * Minimal DER (ITU-T X.690) encoder and reader, enough to build a CMS SignedData (RFC 5652) and to read
 * the issuer and serial number of an X.509 certificate. Kept small on purpose; every structure built with
 * it is checked in the tests by an independent parser (OpenSSL, when available) and by signature
 * verification with `node:crypto`.
 */

/** Encodes a TLV with definite length. */
export function tlv(tag: number, value: Uint8Array): Buffer {
  const len = value.length;
  let header: number[];
  if (len < 0x80) header = [tag, len];
  else {
    const bytes: number[] = [];
    for (let n = len; n > 0; n >>>= 8) bytes.unshift(n & 0xff);
    header = [tag, 0x80 | bytes.length, ...bytes];
  }
  return Buffer.concat([Buffer.from(header), value]);
}

export const seq = (...items: Uint8Array[]): Buffer => tlv(0x30, Buffer.concat(items));

/** DER SET OF: elements sorted by their encodings (X.690 §11.6). */
export const setOf = (...items: Uint8Array[]): Buffer =>
  tlv(0x31, Buffer.concat([...items].map((i) => Buffer.from(i)).sort(Buffer.compare)));

export const octetString = (value: Uint8Array): Buffer => tlv(0x04, value);
export const nullValue = (): Buffer => Buffer.from([0x05, 0x00]);

/** A context-specific constructed tag `[n]` (EXPLICIT, or IMPLICIT over a constructed type). */
export const contextTag = (n: number, value: Uint8Array): Buffer => tlv(0xa0 | n, value);

/** Encodes a small non-negative INTEGER. */
export function integer(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff)
    throw new RangeError('integer out of range');
  const bytes: number[] = [];
  for (let n = value; n > 0; n >>>= 8) bytes.unshift(n & 0xff);
  if (bytes.length === 0 || (bytes[0] ?? 0) & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

/** Encodes an OBJECT IDENTIFIER from its dotted form. */
export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const [a = 0, b = 0, ...rest] = parts;
  const bytes = [40 * a + b];
  for (const part of rest) {
    const stack = [part & 0x7f];
    for (let n = Math.floor(part / 128); n > 0; n = Math.floor(n / 128)) stack.unshift((n & 0x7f) | 0x80);
    bytes.push(...stack);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** A decoded TLV: tag, the whole encoding and the content. */
export interface DerElement {
  tag: number;
  /** Full encoding (header + content). */
  raw: Buffer;
  /** Content octets. */
  content: Buffer;
}

/** Reads one TLV at `offset`. Indefinite lengths and lengths over 4 bytes are refused. */
export function readElement(buf: Buffer, offset = 0): DerElement & { end: number } {
  const tag = buf[offset];
  const first = buf[offset + 1];
  if (tag === undefined || first === undefined) throw new RangeError('Truncated DER');
  let length = first;
  let headerLength = 2;
  if (first & 0x80) {
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new RangeError('Unsupported DER length');
    length = 0;
    for (let i = 0; i < count; i++) {
      const byte = buf[offset + 2 + i];
      if (byte === undefined) throw new RangeError('Truncated DER');
      length = length * 256 + byte;
    }
    headerLength += count;
  }
  const end = offset + headerLength + length;
  if (end > buf.length) throw new RangeError('Truncated DER');
  return {
    tag,
    raw: buf.subarray(offset, end),
    content: buf.subarray(offset + headerLength, end),
    end,
  };
}

/** Reads all TLVs contained in a constructed element's content. */
export function children(element: DerElement): DerElement[] {
  const out: DerElement[] = [];
  for (let offset = 0; offset < element.content.length;) {
    const child = readElement(element.content, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

/**
 * Issuer `Name` and `serialNumber` of a DER X.509 certificate (RFC 5280 §4.1: TBSCertificate ::=
 * SEQUENCE { [0] version OPTIONAL, serialNumber, signature, issuer, … }).
 */
export function issuerAndSerial(certificateDer: Buffer): { issuer: Buffer; serial: Buffer } {
  const certificate = readElement(certificateDer);
  if (certificate.tag !== 0x30 || certificate.end !== certificateDer.length) {
    throw new RangeError('Not a DER certificate');
  }
  const [tbs] = children(certificate);
  if (!tbs || tbs.tag !== 0x30) throw new RangeError('Not a DER certificate');
  const fields = children(tbs);
  const start = fields[0]?.tag === 0xa0 ? 1 : 0;
  const serial = fields[start];
  const issuer = fields[start + 2];
  if (serial?.tag !== 0x02 || issuer?.tag !== 0x30) throw new RangeError('Not a DER certificate');
  return { issuer: Buffer.from(issuer.raw), serial: Buffer.from(serial.raw) };
}

/** Decodes an OBJECT IDENTIFIER element to its dotted form. */
export function oidToString(element: DerElement): string {
  if (element.tag !== 0x06 || element.content.length === 0) throw new RangeError('Not an OID');
  const bytes = [...element.content];
  const first = bytes.shift() ?? 0;
  const parts = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  let value = 0;
  for (const b of bytes) {
    value = value * 128 + (b & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER / 128) throw new RangeError('OID arc too large');
    if (!(b & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/** Decodes a non-negative INTEGER that fits in a safe JS number. */
export function integerValue(element: DerElement): number {
  if (element.tag !== 0x02 || element.content.length === 0 || element.content.length > 6) {
    throw new RangeError('Unsupported INTEGER');
  }
  if ((element.content[0] ?? 0) & 0x80) throw new RangeError('Negative INTEGER');
  return element.content.reduce((n, b) => n * 256 + b, 0);
}
