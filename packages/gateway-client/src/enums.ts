/**
 * Value sets of the FSE 2.0 gateway, copied from the official sources. Each list cites where it comes from;
 * the OpenAPI is it-fse-support `openapi/gateway/swagger_gtw.yaml` (Gateway Dispatcher 1.0.0, commit
 * cf7b7822e8d74da6d653d7d505f1ced29e75e793) and the guide is `doc/integrazione-gateway/README.md`.
 */

/** `HealthDataFormatEnum`. OpenAPI `healthDataFormat.enum`; guide §16.3.11, Tabella 61. */
export const HEALTH_DATA_FORMATS = ['CDA'] as const;

/** `InjectionModeEnum`. OpenAPI `mode.enum`; guide §16.3.10, Tabella 60. */
export const INJECTION_MODES = ['ATTACHMENT', 'RESOURCE'] as const;

/** `ActivityEnum`. OpenAPI `ValidationCDAReqDTO.activity.enum`; guide §16.3.9, Tabella 59. */
export const VALIDATION_ACTIVITIES = ['VERIFICA', 'VALIDATION'] as const;

/**
 * `tipologiaStruttura` (`HealthcareFacilityEnum`, XDSDocumentEntry.healthcareFacilityTypeCode).
 * OpenAPI `PublicationCreationReqDTO.tipologiaStruttura.enum`; guide §16.3.2, Tabella 58.
 */
export const TIPOLOGIE_STRUTTURA = [
  'Ospedale',
  'Prevenzione',
  'Territorio',
  'SistemaTS',
  'Cittadino',
  'MdsPN_DGC',
] as const;

/**
 * `tipoDocumentoLivAlto` (`TipoDocAltoLivEnum`, XDSDocumentEntry.classCode).
 * OpenAPI `PublicationCreationReqDTO.tipoDocumentoLivAlto.enum`; guide §16.3.3.
 */
export const TIPI_DOCUMENTO_LIV_ALTO = [
  'WOR',
  'REF',
  'LDO',
  'RIC',
  'SUM',
  'TAC',
  'PRS',
  'PRE',
  'ESE',
  'PDC',
  'VAC',
  'CER',
  'VRB',
  'CON',
  'CNT',
  'CRT',
  'LET',
  'PRO',
  'COL',
] as const;

/**
 * `tipoAttivitaClinica` (`AttivitaClinicaEnum`, XDSSubmissionSet.contentTypeCode).
 * OpenAPI `PublicationCreationReqDTO.tipoAttivitaClinica.enum`; guide §16.3.1, Tabella 57.
 */
export const TIPI_ATTIVITA_CLINICA = [
  'PHR',
  'CON',
  'DIS',
  'ERP',
  'Sistema_TS',
  'INI',
  'PN_DGC',
  'OBS',
] as const;

/**
 * `administrativeRequest` items (`AdministrativeReqEnum`, XDSDocumentEntry.Slot - administrativeRequest).
 * OpenAPI `PublicationCreationReqDTO.administrativeRequest.items.enum`; guide §16.3.13, Tabella 63.
 */
export const ADMINISTRATIVE_REQUESTS = ['SSN', 'INPATIENT', 'NOSSN', 'SSR', 'DONOR', 'AUTO'] as const;

/**
 * `assettoOrganizzativo` (`PracticeSettingCodeEnum`, XDSDocumentEntry.practiceSettingCode). The 89 codes of
 * OpenAPI `PublicationCreationReqDTO.assettoOrganizzativo.enum`, identical to guide §16.3.8, Tabella 49.
 */
export const ASSETTI_ORGANIZZATIVI = [
  'AD_PSC001',
  'AD_PSC002',
  'AD_PSC003',
  'AD_PSC004',
  'AD_PSC005',
  'AD_PSC006',
  'AD_PSC007',
  'AD_PSC008',
  'AD_PSC009',
  'AD_PSC010',
  'AD_PSC011',
  'AD_PSC012',
  'AD_PSC013',
  'AD_PSC014',
  'AD_PSC015',
  'AD_PSC018',
  'AD_PSC019',
  'AD_PSC020',
  'AD_PSC021',
  'AD_PSC024',
  'AD_PSC025',
  'AD_PSC026',
  'AD_PSC027',
  'AD_PSC028',
  'AD_PSC029',
  'AD_PSC030',
  'AD_PSC031',
  'AD_PSC032',
  'AD_PSC033',
  'AD_PSC034',
  'AD_PSC035',
  'AD_PSC036',
  'AD_PSC037',
  'AD_PSC038',
  'AD_PSC039',
  'AD_PSC040',
  'AD_PSC041',
  'AD_PSC042',
  'AD_PSC043',
  'AD_PSC046',
  'AD_PSC047',
  'AD_PSC048',
  'AD_PSC049',
  'AD_PSC050',
  'AD_PSC051',
  'AD_PSC052',
  'AD_PSC054',
  'AD_PSC055',
  'AD_PSC056',
  'AD_PSC057',
  'AD_PSC058',
  'AD_PSC060',
  'AD_PSC061',
  'AD_PSC062',
  'AD_PSC064',
  'AD_PSC065',
  'AD_PSC066',
  'AD_PSC067',
  'AD_PSC068',
  'AD_PSC069',
  'AD_PSC070',
  'AD_PSC071',
  'AD_PSC072',
  'AD_PSC073',
  'AD_PSC074',
  'AD_PSC075',
  'AD_PSC076',
  'AD_PSC077',
  'AD_PSC078',
  'AD_PSC094',
  'AD_PSC096',
  'AD_PSC097',
  'AD_PSC098',
  'AD_PSC099',
  'AD_PSC100',
  'AD_PSC101',
  'AD_PSC102',
  'AD_PSC103',
  'AD_PSC104',
  'AD_PSC107',
  'AD_PSC109',
  'AD_PSC121',
  'AD_PSC122',
  'AD_PSC126',
  'AD_PSC129',
  'AD_PSC130',
  'AD_PSC131',
  'AD_PSC199',
  'AD_PSC999',
] as const;

/**
 * Correlation between the document type (LOINC code in the `resource_hl7_type` claim) and
 * `tipoDocumentoLivAlto`, checked by the gateway for creation, replacement and metadata update.
 * Source: guide §16.4 "Correlazione tra classCode e typeCode", §16.4.1 "Tabella dei controlli" (the guide
 * writes the LOINC codes with `_` instead of `-`).
 */
export const CLASS_CODE_BY_LOINC: Readonly<Record<string, (typeof TIPI_DOCUMENTO_LIV_ALTO)[number]>> = {
  '57833-6': 'PRS',
  '60591-5': 'SUM',
  '11502-2': 'REF',
  '57829-4': 'PRS',
  '34105-7': 'LDO',
  '18842-5': 'LDO',
  '59258-4': 'VRB',
  '68604-8': 'REF',
  '11526-1': 'REF',
  '59284-0': 'CON',
  '104531-9': 'CRT',
  '57832-8': 'PRS',
  '60593-1': 'PRE',
  '11488-4': 'REF',
  '57827-8': 'ESE',
  '81223-0': 'PRE',
  '18776-5': 'PDC',
  '97500-3': 'CER',
  '87273-9': 'VAC',
  '82593-5': 'VAC',
  '97499-8': 'CER',
  '55750-4': 'SUM',
  '68814-3': 'CNT',
  '103140-0': 'TAC',
  '103144-2': 'PRE',
  '103145-9': 'PRE',
  '103146-7': 'PRE',
  '103147-5': 'PRE',
  '101136-0': 'LET',
  '101134-5': 'PRO',
  '101133-7': 'CON',
  '53576-5': 'TAC',
  '100971-1': 'COL',
  '101881-1': 'SUM',
  '108276-7': 'LET',
  '111490-9': 'LET',
  '112062-5': 'CNT',
  '75496-0': 'REF',
  '85208-7': 'REF',
  '112063-3': 'REF',
  '111827-2': 'CNT',
};
