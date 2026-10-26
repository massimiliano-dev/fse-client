import { createHash } from 'node:crypto';
import { contextTag, integer, issuerAndSerial, nullValue, octetString, oid, seq, setOf, tlv } from './der.js';

/** Object identifiers used in the CAdES signature. */
export const CADES_OIDS = {
  /** id-data, RFC 5652 §4. */
  data: '1.2.840.113549.1.7.1',
  /** id-signedData, RFC 5652 §5. */
  signedData: '1.2.840.113549.1.7.2',
  /** id-contentType, RFC 5652 §11.1. */
  contentType: '1.2.840.113549.1.9.3',
  /** id-messageDigest, RFC 5652 §11.2. */
  messageDigest: '1.2.840.113549.1.9.4',
  /** id-signingTime, RFC 5652 §11.3: must NOT be present in PAdES (ETSI EN 319 142-1 §6.3). */
  signingTime: '1.2.840.113549.1.9.5',
  /** id-aa-signingCertificateV2, RFC 5035 §3. */
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  /** id-sha256, RFC 5754 §2.2. */
  sha256: '2.16.840.1.101.3.4.2.1',
  /** rsaEncryption, RFC 8017 / RFC 5754 §3.2 (what BouncyCastle writes for SHA256withRSA). */
  rsaEncryption: '1.2.840.113549.1.1.1',
} as const;

const sha256 = (data: Uint8Array): Buffer => createHash('sha256').update(data).digest();

function attribute(type: string, value: Buffer): Buffer {
  return seq(oid(type), setOf(value));
}

/**
 * The signed attributes of a PAdES baseline B-B signature (ETSI EN 319 142-1 §6.3, ETSI EN 319 122-1
 * §5.2), DER-encoded as a SET (the form that is signed, RFC 5652 §5.4):
 * - content-type = id-data;
 * - message-digest = SHA-256 of the signed byte ranges;
 * - signing-certificate-v2 with the SHA-256 of the signer certificate and its issuer/serial (RFC 5035).
 *   `hashAlgorithm` is omitted because SHA-256 is the DEFAULT (DER, X.690 §11.5).
 * No signing-time: PAdES puts the claimed signing time in the signature dictionary `M` entry instead.
 *
 * This is the attribute set produced by it-fse-gtw-tools `pdf-generator`
 * (`CreateSignatureBasePades.createSigningCertificateV2Attribute` and
 * `PAdESSignedAttributeTableGenerator`, which removes signingTime and cmsAlgorithmProtect).
 */
export function buildSignedAttributes(contentDigest: Uint8Array, signerCertificateDer: Buffer): Buffer {
  const { issuer, serial } = issuerAndSerial(signerCertificateDer);
  const generalNames = seq(tlv(0xa4, issuer)); // GeneralName directoryName [4] (EXPLICIT: Name is a CHOICE)
  const essCertIdV2 = seq(octetString(sha256(signerCertificateDer)), seq(generalNames, serial));
  const signingCertificateV2 = seq(seq(essCertIdV2));
  return setOf(
    attribute(CADES_OIDS.contentType, oid(CADES_OIDS.data)),
    attribute(CADES_OIDS.messageDigest, octetString(contentDigest)),
    attribute(CADES_OIDS.signingCertificateV2, signingCertificateV2),
  );
}

/**
 * Builds a detached CMS SignedData (RFC 5652 §5) wrapped in a ContentInfo, with one SignerInfo identified
 * by issuer and serial number, SHA-256 and RSA PKCS#1 v1.5.
 *
 * @param signedAttributes the DER SET returned by {@link buildSignedAttributes}.
 * @param signature RSA signature over `signedAttributes`.
 * @param certificatesDer signer certificate first, then the chain; all are embedded.
 */
export function buildCmsSignedData(
  signedAttributes: Buffer,
  signature: Uint8Array,
  certificatesDer: readonly Buffer[],
): Buffer {
  const [signer] = certificatesDer;
  if (!signer) throw new RangeError('At least the signer certificate is required');
  const { issuer, serial } = issuerAndSerial(signer);
  // In the SignerInfo the SET OF attributes is tagged [0] IMPLICIT: same content, tag 0xA0.
  const signedAttrsImplicit = Buffer.concat([Buffer.from([0xa0]), signedAttributes.subarray(1)]);
  const signerInfo = seq(
    integer(1),
    seq(issuer, serial),
    seq(oid(CADES_OIDS.sha256)),
    signedAttrsImplicit,
    seq(oid(CADES_OIDS.rsaEncryption), nullValue()),
    octetString(signature),
  );
  const certificates = [...certificatesDer].map((c) => Buffer.from(c)).sort(Buffer.compare);
  const signedData = seq(
    integer(1),
    setOf(seq(oid(CADES_OIDS.sha256))),
    seq(oid(CADES_OIDS.data)),
    contextTag(0, Buffer.concat(certificates)),
    setOf(signerInfo),
  );
  return seq(oid(CADES_OIDS.signedData), contextTag(0, signedData));
}

/** SHA-256 helper exported for the PDF signer. */
export { sha256 as sha256Digest };
