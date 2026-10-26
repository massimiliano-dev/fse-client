/**
 * Runtime schemas of the gateway request DTOs, written by hand from it-fse-support
 * `openapi/gateway/swagger_gtw.yaml` (`components.schemas`, `additionalProperties: false` everywhere) and
 * `doc/integrazione-gateway/README.md` §16.2 (Tabella 56). Every request body is parsed with these schemas
 * before anything is signed or sent: unknown fields, wrong enum values and over-long strings are refused
 * locally, with error messages that name the field but never echo its value.
 */
import { z } from 'zod';
import {
  ADMINISTRATIVE_REQUESTS,
  ASSETTI_ORGANIZZATIVI,
  HEALTH_DATA_FORMATS,
  INJECTION_MODES,
  TIPI_ATTIVITA_CLINICA,
  TIPI_DOCUMENTO_LIV_ALTO,
  TIPOLOGIE_STRUTTURA,
  VALIDATION_ACTIVITIES,
} from './enums.js';
import { FseConfigError } from './errors.js';
import type {
  PublicationCreationReqDTO,
  PublicationUpdateReqDTO,
  UpdateMetadataOscuramentoReqDTO,
  UpdateMetadataReqDTO,
  ValidateAndCreateDTO,
  ValidateAndReplaceDTO,
  ValidationCDAReqDTO,
} from './types.js';

/** A required string: OpenAPI `maxLength`, and not empty (the gateway answers `/msg/mandatory-element`). */
const requiredString = (max: number) => z.string().min(1).max(max);
const optionalString = (max: number) => z.string().max(max).optional();

/**
 * IHE ITI TF-3 DTM date, as required for `dataInizioPrestazione` / `dataFinePrestazione` (guide §16.2:
 * "Formato codifica conforme alle specifiche IHE (ITI TF-3)", example `20141020110012`): `YYYY[MM[DD[hh[mm[ss]]]]]`.
 * The OpenAPI only says `maxLength: 100`. TODO(verify): which precisions the gateway accepts
 * (`/msg/invalid-format`, instance `/request-invalid-date-format`, guide §15.1.1).
 */
const dtm = z
  .string()
  .regex(/^\d{4}(?:\d{2}){0,5}$/, 'must be an IHE DTM date YYYY[MM[DD[hh[mm[ss]]]]]')
  .optional();

/** `attiCliniciRegoleAccesso` / `descriptions`: OpenAPI `maxItems: 100`, items `maxLength: 1000`. */
const stringList = z.array(z.string().min(1).max(1000)).max(100).optional();

const metadataShape = {
  tipologiaStruttura: z.enum(TIPOLOGIE_STRUTTURA),
  attiCliniciRegoleAccesso: stringList,
  tipoDocumentoLivAlto: z.enum(TIPI_DOCUMENTO_LIV_ALTO),
  assettoOrganizzativo: z.enum(ASSETTI_ORGANIZZATIVI),
  dataInizioPrestazione: dtm,
  dataFinePrestazione: dtm,
  conservazioneANorma: optionalString(100),
  tipoAttivitaClinica: z.enum(TIPI_ATTIVITA_CLINICA),
  identificativoSottomissione: requiredString(100),
  descriptions: stringList,
  // OpenAPI: maxItems 1000; optional (TODO(verify): guide Tabelle 16/26/31/36/41 mark it required).
  administrativeRequest: z.array(z.enum(ADMINISTRATIVE_REQUESTS)).max(1000).optional(),
};

const identificationShape = {
  identificativoDoc: requiredString(256),
  identificativoRep: requiredString(100),
  mode: z.enum(INJECTION_MODES).optional(),
  healthDataFormat: z.enum(HEALTH_DATA_FORMATS).optional(),
};

/** `ValidationCDAReqDTO` (OpenAPI; guide §3.1, Tabella 6). */
export const validationCdaReqSchema = z.strictObject({
  healthDataFormat: z.enum(HEALTH_DATA_FORMATS).optional(),
  mode: z.enum(INJECTION_MODES).optional(),
  activity: z.enum(VALIDATION_ACTIVITIES),
});

/** `PublicationCreationReqDTO` (OpenAPI; guide §5.1, Tabella 16). */
export const publicationCreationReqSchema = z.strictObject({
  ...metadataShape,
  ...identificationShape,
  workflowInstanceId: optionalString(256),
  priorita: z.boolean().optional(),
});

/** `PublicationUpdateReqDTO` (OpenAPI; guide §7.1, Tabella 26). */
export const publicationUpdateReqSchema = z.strictObject({
  ...metadataShape,
  ...identificationShape,
  workflowInstanceId: optionalString(256),
});

/** `ValidateAndCreateDTO` (OpenAPI; guide §10.1, Tabella 36). No `workflowInstanceId`, no `priorita`. */
export const validateAndCreateSchema = z.strictObject({ ...metadataShape, ...identificationShape });

/** `ValidateAndReplaceDTO` (OpenAPI; guide §11.1, Tabella 41). */
export const validateAndReplaceSchema = z.strictObject({ ...metadataShape, ...identificationShape });

/**
 * `UpdateMetadataReqDTO` (OpenAPI; guide §8.1, Tabella 31). The OpenAPI types the enum fields of this DTO as
 * plain strings; the guide gives them the same enum types as the creation (HealthcareFacilityEnum,
 * TipoDocAltoLivEnum, PracticeSettingCodeEnum, AttivitaClinicaEnum, AdministrativeReqEnum), which are
 * enforced here.
 */
export const updateMetadataReqSchema = z.strictObject(metadataShape);

/**
 * `UpdateMetadataOscuramentoReqDTO`. Guide §9: "Il request body è validato sul solo campo
 * attiCliniciRegoleAccesso: l'unico valore ammesso è P99", and Tabella 31 (§9.1) marks it required.
 */
export const updateMetadataOscuramentoReqSchema = z.strictObject({
  attiCliniciRegoleAccesso: z.tuple([z.literal('P99')]),
});

/**
 * Parses a request DTO and returns the parsed copy (unknown keys refused, no prototype tricks). The error
 * lists the offending field paths only.
 *
 * @throws {FseConfigError}
 */
export function parseRequestBody<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.flatMap((issue) => {
          const path = issue.path.map(String).join('.');
          if (issue.code === 'unrecognized_keys') {
            // Key names come from the caller's object, not from patient data; capped in length anyway.
            return issue.keys.map((key) => `${path ? `${path}.` : ''}${key.slice(0, 64)} (unknown field)`);
          }
          return [path || '(root)'];
        }),
      ),
    ].join(', ');
    throw new FseConfigError(`Invalid ${label}, check fields: ${fields}`);
  }
  return parsed.data;
}

// Compile-time checks that the schemas and the exported TypeScript types describe the same objects.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assertSame = <T extends true>(): T | undefined => undefined;
assertSame<Same<z.infer<typeof validationCdaReqSchema>, ValidationCDAReqDTO>>();
assertSame<Same<z.infer<typeof publicationCreationReqSchema>, PublicationCreationReqDTO>>();
assertSame<Same<z.infer<typeof publicationUpdateReqSchema>, PublicationUpdateReqDTO>>();
assertSame<Same<z.infer<typeof validateAndCreateSchema>, ValidateAndCreateDTO>>();
assertSame<Same<z.infer<typeof validateAndReplaceSchema>, ValidateAndReplaceDTO>>();
assertSame<Same<z.infer<typeof updateMetadataReqSchema>, UpdateMetadataReqDTO>>();
assertSame<Same<z.infer<typeof updateMetadataOscuramentoReqSchema>, UpdateMetadataOscuramentoReqDTO>>();
