import { assertSafeXml, DEFAULT_MAX_XML_BYTES } from '@massimiliano-dev/fse-core';
import { runXmllint } from './xmllint.js';

/** OID of the codice fiscale assigning authority (MEF), used in `patientRole/id/@root`. */
export const CODICE_FISCALE_OID = '2.16.840.1.113883.2.9.4.3.2';

/** Header values needed to build the gateway JWT claims. Contains personal data: never log it. */
export interface CdaHeaderInfo {
  /** `recordTarget/patientRole/id[@root=CODICE_FISCALE_OID]/@extension`. */
  patientFiscalCode: string | undefined;
  /** `ClinicalDocument/code/@code` (LOINC). */
  documentTypeCode: string | undefined;
  /** `ClinicalDocument/code/@codeSystem`. */
  documentTypeCodeSystem: string | undefined;
}

const el = (name: string) => `*[local-name()='${name}' and namespace-uri()='urn:hl7-org:v3']`;
const ROOT = `/${el('ClinicalDocument')}`;
const SEP = '|';
const XPATH = `concat(string(${ROOT}/${el('recordTarget')}[1]/${el('patientRole')}/${el('id')}[@root='${CODICE_FISCALE_OID}'][1]/@extension), '${SEP}', string(${ROOT}/${el('code')}/@code), '${SEP}', string(${ROOT}/${el('code')}/@codeSystem))`;

/**
 * Extracts the patient fiscal code and document type from a CDA2 header, with the same hardened parser
 * as the XSD validator (no DTD, no network, size limit).
 */
export async function extractCdaHeader(
  xml: string | Uint8Array,
  options: { maxInputBytes?: number } = {},
): Promise<CdaHeaderInfo> {
  const text = assertSafeXml(xml, { maxBytes: options.maxInputBytes ?? DEFAULT_MAX_XML_BYTES });
  const result = await runXmllint({ xml: text, xpath: XPATH });
  const [cf, code, codeSystem] = result.normalized.replace(/\n$/, '').split(SEP);
  const clean = (v: string | undefined) => (v && /^[\w.-]{1,64}$/.test(v.trim()) ? v.trim() : undefined);
  return {
    patientFiscalCode: clean(cf),
    documentTypeCode: clean(code),
    documentTypeCodeSystem: clean(codeSystem),
  };
}
