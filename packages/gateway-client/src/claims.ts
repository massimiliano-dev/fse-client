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

/**
 * Value set of `purpose_of_use` (guide §16.3.6, Tabella 47): `TREATMENT` for validation and creation,
 * `UPDATE` for delete, replace and metadata update, `ACCESS UPDATE` also for metadata update, `SYSADMIN`
 * only for the "oscuramento a catena" metadata update.
 */
export type FsePurposeOfUse = 'TREATMENT' | 'UPDATE' | 'ACCESS UPDATE' | 'SYSADMIN';

/**
 * Value set of `action_id` (guide §16.3.12, Tabella 62, and §16.1 Tabella 55): `CREATE` for validation and
 * creation, `DELETE` for delete, `UPDATE` for replace and metadata update.
 */
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
  /**
   * `resource_hl7_type`: LOINC document type, e.g. `('11502-2^^2.16.840.1.113883.6.1')`. Required by every
   * operation except delete and "oscuramento a catena" (guide §16.1 Tabella 55: "Non Obbligatorio per il
   * servizio di Eliminazione Documento"; §9: "resource_hl7_type: non obbligatorio").
   */
  resourceHl7Type?: string;
  /**
   * `purpose_of_use`. Defaults per operation (see `FSE_OPERATION_CLAIMS`); a value that the operation does
   * not allow is refused before signing.
   */
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

/** Gateway operations that need the `FSE-JWT-Signature` token. */
export type FseSignedOperation =
  | 'validate'
  | 'publish'
  | 'validateAndCreate'
  | 'replace'
  | 'validateAndReplace'
  | 'delete'
  | 'updateMetadata'
  | 'updateMetadataIti57'
  | 'updateMetadataOscuramentoCatena';

/** Claim rules of one operation. */
export interface FseOperationClaimPolicy {
  actionId: FseActionId;
  /** Used when the context does not set `purposeOfUse`. */
  defaultPurposeOfUse: FsePurposeOfUse;
  /** Values of `purpose_of_use` the gateway accepts for the operation; anything else is refused locally. */
  allowedPurposesOfUse: readonly FsePurposeOfUse[];
  /** `attachment_hash` = SHA-256 of the PDF sent in the multipart `file` part. */
  attachmentHash: 'required' | 'none';
  /** `resource_hl7_type`: required, or sent only when the context provides it. */
  resourceHl7Type: 'required' | 'optional';
  /** Claims whose value is fixed by the specification for this operation (they replace the context). */
  fixedClaims?: { subjectRole?: FseSubjectRole; locality?: string };
}

/**
 * Claim rules per operation. Sources (it-fse-support `doc/integrazione-gateway/README.md`):
 * - §16.1 Tabella 55: `action_id` "CREATE per il servizio di Creazione, DELETE per il servizio di
 *   Eliminazione Documento, UPDATE per il servizio di Sostituzione Documento e Aggiornamento Metadati";
 *   `purpose_of_use` "TREATMENT per il servizio di Validazione, Creazione; UPDATE per il servizio di
 *   Eliminazione Documento, Aggiornamento Metadati e Sostituzione Documento; SYSADMIN per il servizio di
 *   Aggiornamento Metadati per oscuramento a catena"; `attachment_hash` "Obbligatorio per i servizi di
 *   Creazione e Sostituzione Documento"; `resource_hl7_type` "Non Obbligatorio per il servizio di
 *   Eliminazione Documento".
 * - §16.3.6 Tabella 47: `ACCESS UPDATE` is also allowed "per il servizio di Aggiornamento Metadati"; §9:
 *   the metadata endpoint "ammette esclusivamente i valori UPDATE e ACCESS UPDATE".
 * - §16.3.12 Tabella 62: `CREATE` "per il servizio di validazione e per il servizio di Pubblicazione
 *   Creazione Documento".
 * - §9 (oscuramento a catena): `purpose_of_use` SYSADMIN, `action_id` UPDATE, `subject_role` NOR,
 *   `locality` "------" (six "-"), `resource_hl7_type` not required.
 * - §8: `/metadata-iti-57` "rispetta le stesse e identiche specifiche" of `/metadata`.
 *
 * Inferred, not stated explicitly: `validate-and-create` follows the creation and `validate-and-replace`
 * follows the replacement (guide §16.1 groups "CREATE e REPLACE (anche con validazione contestuale)" for the
 * `locality` claim). TODO(verify). `attachment_hash` is also sent for validation, as the official
 * jwt-generator does whenever a file is given (it-fse-gtw-tools `jwt-generator/.../Launcher.java`).
 */
export const FSE_OPERATION_CLAIMS: Readonly<Record<FseSignedOperation, FseOperationClaimPolicy>> = {
  validate: {
    actionId: 'CREATE',
    defaultPurposeOfUse: 'TREATMENT',
    allowedPurposesOfUse: ['TREATMENT'],
    attachmentHash: 'required',
    resourceHl7Type: 'required',
  },
  publish: {
    actionId: 'CREATE',
    defaultPurposeOfUse: 'TREATMENT',
    allowedPurposesOfUse: ['TREATMENT'],
    attachmentHash: 'required',
    resourceHl7Type: 'required',
  },
  validateAndCreate: {
    actionId: 'CREATE',
    defaultPurposeOfUse: 'TREATMENT',
    allowedPurposesOfUse: ['TREATMENT'],
    attachmentHash: 'required',
    resourceHl7Type: 'required',
  },
  replace: {
    actionId: 'UPDATE',
    defaultPurposeOfUse: 'UPDATE',
    allowedPurposesOfUse: ['UPDATE'],
    attachmentHash: 'required',
    resourceHl7Type: 'required',
  },
  validateAndReplace: {
    actionId: 'UPDATE',
    defaultPurposeOfUse: 'UPDATE',
    allowedPurposesOfUse: ['UPDATE'],
    attachmentHash: 'required',
    resourceHl7Type: 'required',
  },
  delete: {
    actionId: 'DELETE',
    defaultPurposeOfUse: 'UPDATE',
    allowedPurposesOfUse: ['UPDATE'],
    attachmentHash: 'none',
    resourceHl7Type: 'optional',
  },
  updateMetadata: {
    actionId: 'UPDATE',
    defaultPurposeOfUse: 'UPDATE',
    allowedPurposesOfUse: ['UPDATE', 'ACCESS UPDATE'],
    attachmentHash: 'none',
    resourceHl7Type: 'required',
  },
  updateMetadataIti57: {
    actionId: 'UPDATE',
    defaultPurposeOfUse: 'UPDATE',
    allowedPurposesOfUse: ['UPDATE', 'ACCESS UPDATE'],
    attachmentHash: 'none',
    resourceHl7Type: 'required',
  },
  updateMetadataOscuramentoCatena: {
    actionId: 'UPDATE',
    defaultPurposeOfUse: 'SYSADMIN',
    allowedPurposesOfUse: ['SYSADMIN'],
    attachmentHash: 'none',
    resourceHl7Type: 'optional',
    fixedClaims: { subjectRole: 'NOR', locality: '------' },
  },
};
