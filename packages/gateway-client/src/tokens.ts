import { createHash, randomUUID } from 'node:crypto';
import type {
  FseActionId,
  FseApplicationInfo,
  FseAuthClaims,
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
  /** Bytes of the PDF sent in the multipart `file` part; its SHA-256 becomes `attachment_hash`. */
  attachment?: Uint8Array;
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

/** Lowercase hex SHA-256, as computed by it-fse-gtw-tools `Utility.encodeSHA256`. */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Builds and signs the `Authorization: Bearer` and `FSE-JWT-Signature` tokens for one request.
 *
 * Replay protection: each token has a random `jti` (UUID v4) and a short lifetime (default and maximum
 * 5 minutes); `attachment_hash` binds the signature token to the exact PDF being sent.
 */
export async function createFseTokens(input: CreateFseTokensInput): Promise<FseTokens> {
  const ttl = input.ttlSeconds ?? MAX_TOKEN_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TOKEN_TTL_SECONDS) {
    throw new FseConfigError(
      `Token lifetime must be an integer between 1 and ${MAX_TOKEN_TTL_SECONDS} seconds`,
    );
  }
  const { context, application } = input;
  for (const [name, value] of Object.entries({
    subject: context.subject,
    subjectOrganizationId: context.subjectOrganizationId,
    subjectOrganization: context.subjectOrganization,
    locality: context.locality,
    personId: context.personId,
    'application.id': application.id,
    'application.vendor': application.vendor,
    'application.version': application.version,
  })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new FseConfigError(`Missing required JWT claim value: ${name}`);
    }
  }

  // Seconds: Tabella 54/55 say "timestamp in secondi" and the official jwt-generator writes
  // `iat.getTime()/1000` (it-fse-gtw-tools Launcher.java). The decoded example in README §16.1 shows
  // millisecond values, which contradicts both; the tables and the reference tool win.
  const iat = Math.floor((input.now ?? (() => new Date()))().getTime() / 1000);
  const exp = iat + ttl;
  const nextJti = input.jti ?? randomUUID;
  const cn = input.signer.certificateCommonName;

  const authClaims: FseAuthClaims = {
    iss: `auth:${cn}`,
    sub: context.subject,
    aud: input.audience,
    iat,
    exp,
    jti: nextJti(),
  };

  const signatureClaims: FseSignatureClaims = {
    iss: `integrity:${cn}`,
    sub: context.subject,
    aud: input.audience,
    iat,
    exp,
    jti: nextJti(),
    subject_role: context.subjectRole,
    purpose_of_use: context.purposeOfUse ?? input.defaultPurposeOfUse,
    locality: context.locality,
    subject_organization: context.subjectOrganization,
    subject_organization_id: context.subjectOrganizationId,
    patient_consent: context.patientConsent,
    action_id: input.actionId,
    resource_hl7_type: context.resourceHl7Type,
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
