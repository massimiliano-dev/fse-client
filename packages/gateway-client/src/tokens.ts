import { createHash, randomUUID } from 'node:crypto';
import type {
  FseActionId,
  FseApplicationInfo,
  FseAuthClaims,
  FseOperationClaimPolicy,
  FsePurposeOfUse,
  FseRequestContext,
  FseSignatureClaims,
} from './claims.js';
import { FseConfigError } from './errors.js';
import type { FseJwtSigner } from './signer.js';

/** Maximum token lifetime accepted by this library: 5 minutes. Tokens are per request (README §2.3). */
export const MAX_TOKEN_TTL_SECONDS = 300;

/** Input of {@link createFseTokens}. */
export interface CreateFseTokensInput {
  signer: FseJwtSigner;
  /** Base URL of the gateway including the version: the `aud` claim (README §16.1). */
  audience: string;
  application: FseApplicationInfo;
  context: FseRequestContext;
  actionId: FseActionId;
  /** Default purpose for the operation, used when the context does not set one. */
  defaultPurposeOfUse: FsePurposeOfUse;
  /** Purposes accepted for the operation. When set, any other `purposeOfUse` is refused. */
  allowedPurposesOfUse?: readonly FsePurposeOfUse[];
  /** Bytes of the PDF sent in the multipart `file` part; its SHA-256 becomes `attachment_hash`. */
  attachment?: Uint8Array;
  /** `required` (default) refuses a context without `resourceHl7Type`; `optional` omits the claim then. */
  resourceHl7Type?: FseOperationClaimPolicy['resourceHl7Type'];
  /** Claims fixed by the specification for the operation, replacing the context values. */
  fixedClaims?: FseOperationClaimPolicy['fixedClaims'];
  /** Token lifetime in seconds, 1–300. Default 300. */
  ttlSeconds?: number;
  /** Clock (tests). */
  now?: () => Date;
  /** `jti` generator (tests). Default `crypto.randomUUID`. */
  jti?: () => string;
}

/** The two tokens of a gateway call, plus the decoded claims for dry runs and tests. */
export interface FseTokens {
  /** Value of the `Authorization` header without the `Bearer ` prefix. */
  authorization: string;
  /** Value of the `FSE-JWT-Signature` header. */
  signature: string;
  authClaims: FseAuthClaims;
  signatureClaims: FseSignatureClaims;
}

/** Input of {@link createFseAuthToken}. */
export interface CreateFseAuthTokenInput {
  signer: FseJwtSigner;
  /** Base URL of the gateway including the version: the `aud` claim. */
  audience: string;
  /** `sub`: fiscal code of the operator (or VAT number of the organisation), IHE CX format. */
  subject: string;
  ttlSeconds?: number;
  now?: () => Date;
  jti?: () => string;
}

/** The `Authorization: Bearer` token alone, used by the transaction status services. */
export interface FseAuthToken {
  authorization: string;
  authClaims: FseAuthClaims;
}

/** Lowercase hex SHA-256, as computed by it-fse-gtw-tools `Utility.encodeSHA256`. */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function reservedClaims(
  input: Pick<CreateFseAuthTokenInput, 'audience' | 'ttlSeconds' | 'now' | 'jti'>,
  subject: string,
) {
  const ttl = input.ttlSeconds ?? MAX_TOKEN_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TOKEN_TTL_SECONDS) {
    throw new FseConfigError(
      `Token lifetime must be an integer between 1 and ${MAX_TOKEN_TTL_SECONDS} seconds`,
    );
  }
  if (typeof subject !== 'string' || subject.trim() === '') {
    throw new FseConfigError('Missing required JWT claim value: subject');
  }
  // Seconds: Tabella 54/55 say "timestamp in secondi" and the official jwt-generator writes
  // `iat.getTime()/1000` (it-fse-gtw-tools Launcher.java). The decoded example in README §16.1 shows
  // millisecond values, which contradicts both; the tables and the reference tool win.
  const iat = Math.floor((input.now ?? (() => new Date()))().getTime() / 1000);
  return { sub: subject, aud: input.audience, iat, exp: iat + ttl };
}

/**
 * Builds and signs the `Authorization: Bearer` token alone (guide §16.1, Tabella 54). The transaction
 * status services require only this header (guide §13.1 Tabella 46 and §14.1 Tabella 51).
 */
export async function createFseAuthToken(input: CreateFseAuthTokenInput): Promise<FseAuthToken> {
  const reserved = reservedClaims(input, input.subject);
  const authClaims: FseAuthClaims = {
    iss: `auth:${input.signer.certificateCommonName}`,
    ...reserved,
    jti: (input.jti ?? randomUUID)(),
  };
  const authorization = await input.signer.sign(authClaims as unknown as Record<string, unknown>);
  return { authorization, authClaims };
}

/**
 * Builds and signs the `Authorization: Bearer` and `FSE-JWT-Signature` tokens for one request.
 *
 * Replay protection: each token has a random `jti` (UUID v4) and a short lifetime (default and maximum
 * 5 minutes); `attachment_hash` binds the signature token to the exact PDF being sent.
 */
export async function createFseTokens(input: CreateFseTokensInput): Promise<FseTokens> {
  const { context, application } = input;
  const reserved = reservedClaims(input, context.subject);
  const subjectRole = input.fixedClaims?.subjectRole ?? context.subjectRole;
  const locality = input.fixedClaims?.locality ?? context.locality;
  for (const [name, value] of Object.entries({
    subjectRole,
    subjectOrganizationId: context.subjectOrganizationId,
    subjectOrganization: context.subjectOrganization,
    locality,
    personId: context.personId,
    'application.id': application.id,
    'application.vendor': application.vendor,
    'application.version': application.version,
  })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new FseConfigError(`Missing required JWT claim value: ${name}`);
    }
  }
  if (typeof context.patientConsent !== 'boolean') {
    throw new FseConfigError('Missing required JWT claim value: patientConsent');
  }
  const resourceHl7Type = context.resourceHl7Type;
  const hasResourceType = typeof resourceHl7Type === 'string' && resourceHl7Type.trim() !== '';
  if ((input.resourceHl7Type ?? 'required') === 'required' && !hasResourceType) {
    throw new FseConfigError('Missing required JWT claim value: resourceHl7Type');
  }
  const purposeOfUse = context.purposeOfUse ?? input.defaultPurposeOfUse;
  if (input.allowedPurposesOfUse && !input.allowedPurposesOfUse.includes(purposeOfUse)) {
    throw new FseConfigError(
      `purpose_of_use ${purposeOfUse} is not allowed for this operation (allowed: ${input.allowedPurposesOfUse.join(', ')})`,
    );
  }

  const nextJti = input.jti ?? randomUUID;
  const cn = input.signer.certificateCommonName;

  const authClaims: FseAuthClaims = { iss: `auth:${cn}`, ...reserved, jti: nextJti() };

  const signatureClaims: FseSignatureClaims = {
    iss: `integrity:${cn}`,
    ...reserved,
    jti: nextJti(),
    subject_role: subjectRole,
    purpose_of_use: purposeOfUse,
    locality,
    subject_organization: context.subjectOrganization,
    subject_organization_id: context.subjectOrganizationId,
    patient_consent: context.patientConsent,
    action_id: input.actionId,
    ...(hasResourceType ? { resource_hl7_type: resourceHl7Type } : {}),
    person_id: context.personId,
    subject_application_id: application.id,
    subject_application_vendor: application.vendor,
    subject_application_version: application.version,
    ...(input.attachment ? { attachment_hash: sha256Hex(input.attachment) } : {}),
    ...(context.useSubjectAsAuthor === undefined
      ? {}
      : { use_subject_as_author: context.useSubjectAsAuthor }),
  };

  const [authorization, signature] = await Promise.all([
    input.signer.sign(authClaims as unknown as Record<string, unknown>),
    input.signer.sign(signatureClaims as unknown as Record<string, unknown>),
  ]);
  return { authorization, signature, authClaims, signatureClaims };
}
