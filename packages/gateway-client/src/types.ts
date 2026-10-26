/**
 * Request and response types of the FSE 2.0 gateway.
 *
 * Source: ministero-salute/it-fse-support, `openapi/gateway/swagger_gtw.yaml` (Gateway Dispatcher 1.0.0,
 * commit cf7b7822e8d74da6d653d7d505f1ced29e75e793), `components.schemas`. Field names are the official
 * Italian ones on purpose, so they can be compared with the specification.
 */

/** `HealthDataFormatEnum` (Tabella 61). */
export type HealthDataFormat = 'CDA';

/** `InjectionModeEnum` (Tabella 60): CDA as PDF attachment (EmbeddedFiles) or as XFA resource. */
export type InjectionMode = 'ATTACHMENT' | 'RESOURCE';

/**
 * `ActivityEnum` (Tabella 59): `VERIFICA` = validation only, never followed by publication;
 * `VALIDATION` = validation meant to be followed by a publication with the returned `workflowInstanceId`.
 */
export type ValidationActivity = 'VERIFICA' | 'VALIDATION';

/** `tipologiaStruttura` enum of `PublicationCreationReqDTO`. */
export type TipologiaStruttura =
  'Ospedale' | 'Prevenzione' | 'Territorio' | 'SistemaTS' | 'Cittadino' | 'MdsPN_DGC';

/** `tipoDocumentoLivAlto` enum (Tabella "Tipo Documento Alto Livello", §16.3.3). */
export type TipoDocumentoLivAlto =
  | 'WOR'
  | 'REF'
  | 'LDO'
  | 'RIC'
  | 'SUM'
  | 'TAC'
  | 'PRS'
  | 'PRE'
  | 'ESE'
  | 'PDC'
  | 'VAC'
  | 'CER'
  | 'VRB'
  | 'CON'
  | 'CNT'
  | 'CRT'
  | 'LET'
  | 'PRO'
  | 'COL';

/** `tipoAttivitaClinica` enum (§16.3.1). */
export type TipoAttivitaClinica = 'PHR' | 'CON' | 'DIS' | 'ERP' | 'Sistema_TS' | 'INI' | 'PN_DGC' | 'OBS';

/** `administrativeRequest` items (§16.3.13). */
export type AdministrativeRequest = 'SSN' | 'INPATIENT' | 'NOSSN' | 'SSR' | 'DONOR' | 'AUTO';

/**
 * `assettoOrganizzativo`: practice setting code `AD_PSCnnn` (§16.3.8). The OpenAPI lists the allowed codes;
 * the template type keeps the client usable when the list changes.
 */
export type AssettoOrganizzativo = `AD_PSC${string}`;

/** `ValidationCDAReqDTO`: the `requestBody` part of `POST /documents/validation`. */
export interface ValidationCDAReqDTO {
  /** Required. */
  activity: ValidationActivity;
  /** Optional; omitting it makes the gateway return a warning (README §3.1). */
  mode?: InjectionMode;
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
 * RFC 7807 problem document returned on errors (`ErrorResponseDTO` / `ValidationErrorResponseDTO`).
 * See README §15 "Drilldown Response in caso di Errore" for the `type` values (`/msg/syntax`,
 * `/msg/semantic`, `/msg/vocabulary`, …).
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
}

/** Common metadata fields of `PublicationCreationReqDTO` / `PublicationUpdateReqDTO` / `ValidateAndCreateDTO`. */
export interface PublicationMetadata {
  tipologiaStruttura: TipologiaStruttura;
  attiCliniciRegoleAccesso?: string[];
  tipoDocumentoLivAlto: TipoDocumentoLivAlto;
  assettoOrganizzativo: AssettoOrganizzativo;
  dataInizioPrestazione?: string;
  dataFinePrestazione?: string;
  conservazioneANorma?: string;
  tipoAttivitaClinica: TipoAttivitaClinica;
  identificativoSottomissione: string;
  descriptions?: string[];
  administrativeRequest?: AdministrativeRequest[];
}

/** `PublicationCreationReqDTO`: `requestBody` part of `POST /documents`. */
export interface PublicationCreationReqDTO extends PublicationMetadata {
  identificativoDoc: string;
  identificativoRep: string;
  mode?: InjectionMode;
  healthDataFormat?: HealthDataFormat;
  /** Returned by a previous validation with activity `VALIDATION`. */
  workflowInstanceId?: string;
  priorita?: boolean;
}

/** `PublicationUpdateReqDTO`: `requestBody` part of `PUT /documents/{idDoc}` (replace). */
export interface PublicationUpdateReqDTO extends PublicationMetadata {
  identificativoDoc: string;
  identificativoRep: string;
  mode?: InjectionMode;
  healthDataFormat?: HealthDataFormat;
  workflowInstanceId?: string;
}

/** `UpdateMetadataReqDTO`: JSON body of `PUT /documents/{idDoc}/metadata`. */
export type UpdateMetadataReqDTO = PublicationMetadata;

/** `PublicationResDTO`: 202 response of create/replace. */
export interface PublicationResDTO {
  traceID?: string;
  spanID?: string;
  warning?: string;
  workflowInstanceId?: string;
  /** FHIR bundle resulting from the CDA transformation (JSON string). */
  fhirBundle?: string;
}

/** `ResponseWifDTO`: response of delete and metadata update. */
export interface ResponseWifDTO {
  traceID?: string;
  spanID?: string;
  warning?: string;
  workflowInstanceId?: string;
}
