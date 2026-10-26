export { UnsafeXmlError, OptionalDependencyMissingError } from '@massimiliano-dev/fse-core';
export type {
  CdaIssueSeverity,
  CdaIssueSource,
  CdaValidationIssue,
  CdaValidationResult,
  CdaValidator,
} from './types.js';
export { XsdValidator, type XsdSchemaSet, type XsdValidatorOptions } from './xsd.js';
export type { XmlFile } from './xmllint.js';
export {
  CATALOGS_COMMIT_MARKER,
  createFseXsdValidator,
  FSE_CATALOGS_COMMIT,
  FSE_CATALOGS_REPOSITORY,
  loadFseCdaSchema,
  type FseCdaSchemaVariant,
  type LoadedCdaSchema,
} from './catalogs.js';
export { CODICE_FISCALE_OID, extractCdaHeader, type CdaHeaderInfo } from './header.js';
export {
  SaxonSchematronValidator,
  type SaxonJsLike,
  type SaxonSchematronOptions,
  type SchematronValidator,
} from './schematron.js';
export { CompositeCdaValidator } from './composite.js';
