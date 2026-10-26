export { NotImplementedError, redact, redactValue } from '@massimiliano-dev/fse-core';
export {
  FseGatewayClient,
  type DeleteInput,
  type FseGatewayClientOptions,
  type PublishInput,
  type ReplaceInput,
  type UpdateMetadataInput,
} from './client.js';
export { FSE_ENVIRONMENTS, isFseEnvironment, normalizeBaseUrl, type FseEnvironment } from './environments.js';
export {
  FseAuthError,
  FseConfigError,
  FseGatewayError,
  FseTransportError,
  FseValidationError,
  type FseGatewayErrorInit,
  type FseValidationIssue,
} from './errors.js';
export type {
  FseActionId,
  FseApplicationInfo,
  FseAuthClaims,
  FsePurposeOfUse,
  FseRequestContext,
  FseReservedClaims,
  FseSignatureClaims,
  FseSubjectRole,
} from './claims.js';
export {
  RsaPemJwtSigner,
  type FseJwtAlgorithm,
  type FseJwtSigner,
  type RsaPemJwtSignerOptions,
} from './signer.js';
export {
  createFseTokens,
  MAX_TOKEN_TTL_SECONDS,
  sha256Hex,
  type CreateFseTokensInput,
  type FseTokens,
} from './tokens.js';
export {
  DEFAULT_MAX_PDF_BYTES,
  prepareValidationRequest,
  summarizePreparedRequest,
  type PreparedFseRequest,
  type PrepareSettings,
  type ValidateInput,
} from './request.js';
export { DEFAULT_MAX_RESPONSE_BYTES, type ValidationResult } from './response.js';
export { buildTlsConnectOptions, type FseTlsOptions } from './tls.js';
export type * from './types.js';
