/**
 * JWT claims of the two tokens sent with every gateway call.
 *
 * Source: ministero-salute/it-fse-support, `doc/integrazione-gateway/README.md` §2.3 and §16.1
 * (Tabella 54 "Authentication Bearer Token", Tabella 55 "FSE-JWT-Signature"), and the reference generator
 * ministero-salute/it-fse-gtw-tools `jwt-generator/src/main/java/it/finanze/sanita/fjm/Launcher.java`
 * (commit 6967f3ab916ec2b977de521497cfdba61d19659b).
 */

/** Value set of `subject_role` (Tabella 46, Affinity Domain Italia 2.6). */
export type FseSubjectRole =
  | 'AAS'
  | 'APR'
  | 'PSS'
  | 'INF'
  | 'FAR'
  | 'DSA'
  | 'DAM'
  | 'OAM'
  | 'ASS'
  | 'TUT'
  | 'ING'
  | 'GEN'
  | 'NOR'
  | 'DRS'
  | 'RSA'
  | 'MRP'
  | 'INI'
  | 'OGC'
  | 'OPI'
  | 'MDS'
  | 'GTW'
  | 'DAP';

/** Value set of `purpose_of_use` (Tabella 47). Validation and creation use `TREATMENT`. */
export type FsePurposeOfUse = 'TREATMENT' | 'UPDATE' | 'ACCESS UPDATE' | 'SYSADMIN';

/** Value set of `action_id` (Tabella 62). Validation and creation use `CREATE`. */
export type FseActionId = 'CREATE' | 'DELETE' | 'UPDATE';

/** Software identification registered during accreditation (`subject_application_*` claims). */
export interface FseApplicationInfo {
  /** `subject_application_id`, e.g. `BARMED`. */
  id: string;
  /** `subject_application_vendor`, e.g. `FOO SPA`. */
  vendor: string;
  /** `subject_application_version`, e.g. `V.4.2.0`. */
  version: string;
}

/**
 * Per-request context: who is calling, for which patient and which document. These values are personal
 * data and are never logged by this library.
 */
export interface FseRequestContext {
  /**
   * `sub`: fiscal code of the operator (or VAT number of the organisation) in IHE CX format, e.g.
   * `XXXXXX00X00X000X^^^&2.16.840.1.113883.2.9.4.3.2&ISO`.
   */
  subject: string;
  /** `subject_role` (Tabella 46). */
  subjectRole: FseSubjectRole;
  /** `subject_organization_id`, e.g. `190` (TABELLA ORGANIZZAZIONE). */
  subjectOrganizationId: string;
  /** `subject_organization`, e.g. `Regione Sicilia`. */
  subjectOrganization: string;
  /** `locality`: facility in XON format, e.g. `LABORATORIO DI PROVA^^^^^&2.16.840.1.113883.2.9.4.1.3&ISO^^^^111101123456`. */
  locality: string;
  /** `person_id`: patient (or parent/guardian) in IHE CX format. */
  personId: string;
  /** `patient_consent` ("presa in carico"). */
  patientConsent: boolean;
  /** `resource_hl7_type`: LOINC document type, e.g. `('11502-2^^2.16.840.1.113883.6.1')`. */
  resourceHl7Type: string;
  /** `purpose_of_use`. Defaults per operation (validation: `TREATMENT`). */
  purposeOfUse?: FsePurposeOfUse;
  /** `use_subject_as_author` (optional). */
  useSubjectAsAuthor?: boolean;
}

/** Reserved claims present in both tokens. `iat`/`exp` are in seconds (as in jwt-generator). */
export interface FseReservedClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

/** Payload of the `Authorization: Bearer` token (Tabella 54). `iss` = `auth:<signature certificate CN>`. */
export type FseAuthClaims = FseReservedClaims;

/** Payload of the `FSE-JWT-Signature` token (Tabella 55). `iss` = `integrity:<signature certificate CN>`. */
export interface FseSignatureClaims extends FseReservedClaims {
  subject_role: FseSubjectRole;
  purpose_of_use: FsePurposeOfUse;
  locality: string;
  subject_organization: string;
  subject_organization_id: string;
  patient_consent: boolean;
  action_id: FseActionId;
  resource_hl7_type?: string;
  person_id: string;
  /** Lowercase hex SHA-256 of the PDF sent in the multipart `file` part. */
  attachment_hash?: string;
  subject_application_id: string;
  subject_application_vendor: string;
  subject_application_version: string;
  use_subject_as_author?: boolean;
}
