/**
 * Request and response types of the FSE 2.0 gateway.
 *
 * Source: ministero-salute/it-fse-support, `openapi/gateway/swagger_gtw.yaml` (Gateway Dispatcher 1.0.0,
 * commit cf7b7822e8d74da6d653d7d505f1ced29e75e793), `components.schemas`, and
 * `doc/integrazione-gateway/README.md` (the "guide") §16.2 "Campi Contenuti nella Request Body". Field
 * names are the official Italian ones on purpose, so they can be compared with the specification. The
 * runtime checks of every request DTO are in `schemas.ts`.
 */
import type {
  ADMINISTRATIVE_REQUESTS,
  ASSETTI_ORGANIZZATIVI,
  HEALTH_DATA_FORMATS,
  INJECTION_MODES,
  TIPI_ATTIVITA_CLINICA,
  TIPI_DOCUMENTO_LIV_ALTO,
  TIPOLOGIE_STRUTTURA,
  VALIDATION_ACTIVITIES,
} from './enums.js';

/** `HealthDataFormatEnum` (guide Tabella 61). */
export type HealthDataFormat = (typeof HEALTH_DATA_FORMATS)[number];

/** `InjectionModeEnum` (guide Tabella 60): CDA as PDF attachment (EmbeddedFiles) or as XFA resource. */
export type InjectionMode = (typeof INJECTION_MODES)[number];

/**
 * `ActivityEnum` (guide Tabella 59): `VERIFICA` = validation only, never followed by publication;
 * `VALIDATION` = validation meant to be followed by a publication with the returned `workflowInstanceId`.
 */
export type ValidationActivity = (typeof VALIDATION_ACTIVITIES)[number];

/** `tipologiaStruttura` (guide §16.3.2, Tabella 58). */
export type TipologiaStruttura = (typeof TIPOLOGIE_STRUTTURA)[number];

/** `tipoDocumentoLivAlto` (guide §16.3.3). */
export type TipoDocumentoLivAlto = (typeof TIPI_DOCUMENTO_LIV_ALTO)[number];

/** `tipoAttivitaClinica` (guide §16.3.1, Tabella 57). */
export type TipoAttivitaClinica = (typeof TIPI_ATTIVITA_CLINICA)[number];

/** `administrativeRequest` items (guide §16.3.13, Tabella 63). */
export type AdministrativeRequest = (typeof ADMINISTRATIVE_REQUESTS)[number];

/** `assettoOrganizzativo`: practice setting code (guide §16.3.8, Tabella 49; 89 codes in the OpenAPI). */
export type AssettoOrganizzativo = (typeof ASSETTI_ORGANIZZATIVI)[number];

/** `ValidationCDAReqDTO`: the `requestBody` part of `POST /documents/validation`. */
export interface ValidationCDAReqDTO {
  /** Required. */
  activity: ValidationActivity;
  /** Optional; omitting it makes the gateway return a warning (guide §3.1). Default here: `ATTACHMENT`. */
  mode?: InjectionMode;
  /** Optional; `CDA` is assumed when omitted (guide §16.2). */
  healthDataFormat?: HealthDataFormat;
}

/** `ValidationResDTO`: body of a 200 (VERIFICA) or 201 (VALIDATION) response. */
export interface ValidationResDTO {
  traceID?: string;
  spanID?: string;
  /** Transaction id (IHE CXi) to pass to the publication. */
  workflowInstanceId?: string;
  warning?: string;
}

/**
 * RFC 7807 problem document returned on errors (`ErrorResponseDTO` / `ValidationErrorResponseDTO`, and the
 * GovWay errors of guide §15.2). See guide §15 "Drilldown Response in caso di Errore" for the `type` values
 * (`/msg/syntax`, `/msg/semantic`, `/msg/vocabulary`, …).
 */
export interface FseProblemDetails {
  traceID?: string;
  spanID?: string;
  /** Problem type URI, e.g. `/msg/syntax`. */
  type?: string;
  title?: string;
  detail?: string;
  status?: number;
  instance?: string;
  /** Only in `ValidationErrorResponseDTO`. */
  workflowInstanceId?: string;
  /** GovWay transaction id, for errors raised by the frontier devices (guide §15.2, Tabella 53). */
  govway_id?: string;
}

/**
 * Metadata fields shared by `PublicationCreationReqDTO`, `PublicationUpdateReqDTO`, `ValidateAndCreateDTO`,
 * `ValidateAndReplaceDTO` and `UpdateMetadataReqDTO` (guide §16.2, Tabella 56).
 */
export interface PublicationMetadata {
  /** Required. XDSDocumentEntry.healthcareFacilityTypeCode. */
  tipologiaStruttura: TipologiaStruttura;
  /** XDSDocumentEntry.eventCodeList (e.g. `P99` for blacking-out). At most 100 items of 1000 characters. */
  attiCliniciRegoleAccesso?: string[];
  /** Required. XDSDocumentEntry.classCode. Must match the document type (guide §16.4). */
  tipoDocumentoLivAlto: TipoDocumentoLivAlto;
  /** Required. XDSDocumentEntry.practiceSettingCode. */
  assettoOrganizzativo: AssettoOrganizzativo;
  /** XDSDocumentEntry.serviceStartTime, IHE DTM, e.g. `20141020110012`. */
  dataInizioPrestazione?: string;
  /** XDSDocumentEntry.serviceStopTime, IHE DTM, e.g. `20141020110012`. */
  dataFinePrestazione?: string;
  /** XDSDocumentEntry.Slot "Conservazione a norma", e.g. `CONS^^^&2.16.840.1.113883.2.9.3.3.6.1.7&ISO`. */
  conservazioneANorma?: string;
  /** Required. XDSSubmissionSet.contentTypeCode. */
  tipoAttivitaClinica: TipoAttivitaClinica;
  /** Required. XDSSubmissionSet.uniqueId (OID). */
  identificativoSottomissione: string;
  /** XDSDocumentEntry.Slot description, `[CODICE]^[Descrizione]^[OID]`. */
  descriptions?: string[];
  /**
   * XDSDocumentEntry.Slot administrativeRequest. Optional in the OpenAPI and in guide §16.2 ("Facoltativo"),
   * but marked required in guide Tabelle 16/26/31/36/41. TODO(verify).
   */
  administrativeRequest?: AdministrativeRequest[];
}

/** Fields shared by the creation and replacement DTOs. */
export interface DocumentIdentification {
  /** Required. XDSDocumentEntry.uniqueId, e.g. `2.16.840.1.113883.2.9.2.80.4.4^514782`. */
  identificativoDoc: string;
  /** Required. XDSDocumentEntry.repositoryUniqueId, e.g. `2.16.840.1.113883.2.9.2.80.4.5.1234`. */
  identificativoRep: string;
  /** Default here: `ATTACHMENT` (omitting it makes the gateway return a warning). */
  mode?: InjectionMode;
  /** Default here: `CDA`. */
  healthDataFormat?: HealthDataFormat;
}

/** `PublicationCreationReqDTO`: `requestBody` part of `POST /documents`. */
export interface PublicationCreationReqDTO extends PublicationMetadata, DocumentIdentification {
  /**
   * Returned by a previous validation with activity `VALIDATION`. Optional in the OpenAPI and in guide
   * Tabella 16, "Obbligatorio (solo per servizio di pubblicazione)" in guide §16.2. TODO(verify).
   */
  workflowInstanceId?: string;
  /** `priorita` (OpenAPI only; not described in the guide). */
  priorita?: boolean;
}

/** `PublicationUpdateReqDTO`: `requestBody` part of `PUT /documents/{idDoc}` (replace). */
export interface PublicationUpdateReqDTO extends PublicationMetadata, DocumentIdentification {
  workflowInstanceId?: string;
}

/** `ValidateAndCreateDTO`: `requestBody` part of `POST /documents/validate-and-create`. */
export type ValidateAndCreateDTO = PublicationMetadata & DocumentIdentification;

/** `ValidateAndReplaceDTO`: `requestBody` part of `PUT /documents/validate-and-replace/{idDoc}`. */
export type ValidateAndReplaceDTO = PublicationMetadata & DocumentIdentification;

/** `UpdateMetadataReqDTO`: JSON body of `PUT /documents/{idDoc}/metadata` and `/metadata-iti-57`. */
export type UpdateMetadataReqDTO = PublicationMetadata;

/**
 * `UpdateMetadataOscuramentoReqDTO`: JSON body of `PUT /documents/{idDoc}/metadata-oscuramento-catena`.
 * Guide §9: required, and the only accepted value is `P99`.
 */
export interface UpdateMetadataOscuramentoReqDTO {
  attiCliniciRegoleAccesso: ['P99'];
}

/** `PublicationResDTO`: 202 response of create/replace (and validate-and-create/replace). */
export interface PublicationResDTO {
  traceID?: string;
  spanID?: string;
  warning?: string;
  workflowInstanceId?: string;
  /**
   * FHIR bundle resulting from the CDA transformation (JSON string). Health data: returned only when the
   * call sets `includeFhirBundle: true`.
   */
  fhirBundle?: string;
}

/** `ResponseWifDTO`: response of delete and metadata updates. */
export interface ResponseWifDTO {
  traceID?: string;
  spanID?: string;
  warning?: string;
  workflowInstanceId?: string;
}

/**
 * `StatusCheckDTO`: one event of a transaction (guide §13.2, Tabella 49). Free-text fields are redacted
 * by this client (fiscal codes, XML/SOAP payloads).
 */
export interface StatusCheckDTO {
  /** e.g. `VALIDATION`, `PUBLICATION`, `SEND_TO_INI`, `SEND_TO_UAR`, `UAR_FINAL_STATUS` (guide §12.6). */
  eventType?: string;
  eventDate?: string;
  /** `SUCCESS`, `BLOCKING_ERROR`, … (guide §12.6, §13.2). */
  eventStatus?: string;
  message?: string;
  identificativoDocumento?: string;
  subject?: string;
  subjectRole?: string;
  tipoAttivita?: string;
  organizzazione?: string;
  workflowInstanceId?: string;
  traceId?: string;
  issuer?: string;
  expiringDate?: string;
  extra?: string;
}

/** `TransactionInspectResDTO`: response of `GET /status/{workflowInstanceId}` and `/status/search/{traceId}`. */
export interface TransactionInspectResDTO {
  traceID?: string;
  spanID?: string;
  transactionData?: StatusCheckDTO[];
}
