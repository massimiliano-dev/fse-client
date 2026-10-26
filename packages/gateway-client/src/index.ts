export { NotImplementedError, redact, redactValue } from '@massimiliano-dev/fse-core';
export { FseGatewayClient, type FseCallOptions, type FseGatewayClientOptions } from './client.js';
export { FSE_ENVIRONMENTS, isFseEnvironment, normalizeBaseUrl, type FseEnvironment } from './environments.js';
export {
  FseAuthError,
  FseConfigError,
  FseGatewayError,
  FseNotFoundError,
  FseTransportError,
  FseValidationError,
  type FseGatewayErrorInit,
  type FseValidationIssue,
} from './errors.js';
export {
  FSE_OPERATION_CLAIMS,
  type FseActionId,
  type FseApplicationInfo,
  type FseAuthClaims,
  type FseOperationClaimPolicy,
  type FsePurposeOfUse,
  type FseRequestContext,
  type FseReservedClaims,
  type FseSignatureClaims,
  type FseSignedOperation,
  type FseSubjectRole,
} from './claims.js';
export {
  RsaPemJwtSigner,
  type FseJwtAlgorithm,
  type FseJwtSigner,
  type RsaPemJwtSignerOptions,
} from './signer.js';
export {
  createFseAuthToken,
  createFseTokens,
  MAX_TOKEN_TTL_SECONDS,
  sha256Hex,
  type CreateFseAuthTokenInput,
  type CreateFseTokensInput,
  type FseAuthToken,
  type FseTokens,
} from './tokens.js';
export {
  checkClassCodeCorrelation,
  DEFAULT_MAX_PDF_BYTES,
  prepareDeleteRequest,
  preparePublicationRequest,
  prepareReplaceRequest,
  prepareStatusRequest,
  prepareUpdateMetadataOscuramentoRequest,
  prepareUpdateMetadataRequest,
  prepareValidateAndCreateRequest,
  prepareValidateAndReplaceRequest,
  prepareValidationRequest,
  summarizePreparedRequest,
  type DeleteInput,
  type DocumentUploadInput,
  type FseOperation,
  type PreparedBody,
  type PreparedFseRequest,
  type PrepareSettings,
  type PublishInput,
  type ReplaceInput,
  type StatusQueryInput,
  type UpdateMetadataInput,
  type UpdateMetadataOscuramentoInput,
  type ValidateAndCreateInput,
  type ValidateAndReplaceInput,
  type ValidateInput,
} from './request.js';
export {
  DEFAULT_MAX_RESPONSE_BYTES,
  redactStatusText,
  type PublicationResult,
  type TransactionStatusResult,
  type ValidationResult,
  type WorkflowResult,
} from './response.js';
export {
  DEFAULT_FINAL_EVENT_TYPES,
  defaultTransactionOutcome,
  type WaitForStatusOptions,
  type WaitForStatusResult,
} from './status.js';
export { encodePathParam, PATH_PARAM_LIMITS, type FsePathParam } from './path.js';
export {
  publicationCreationReqSchema,
  publicationUpdateReqSchema,
  updateMetadataOscuramentoReqSchema,
  updateMetadataReqSchema,
  validateAndCreateSchema,
  validateAndReplaceSchema,
  validationCdaReqSchema,
} from './schemas.js';
export {
  ADMINISTRATIVE_REQUESTS,
  ASSETTI_ORGANIZZATIVI,
  CLASS_CODE_BY_LOINC,
  HEALTH_DATA_FORMATS,
  INJECTION_MODES,
  TIPI_ATTIVITA_CLINICA,
  TIPI_DOCUMENTO_LIV_ALTO,
  TIPOLOGIE_STRUTTURA,
  VALIDATION_ACTIVITIES,
} from './enums.js';
export { buildTlsConnectOptions, type FseTlsOptions } from './tls.js';
export type * from './types.js';
