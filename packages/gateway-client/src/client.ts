import { NotImplementedError } from '@massimiliano-dev/fse-core';
import { inspect } from 'node:util';
import { FormData, type Agent } from 'undici';
import type { FseApplicationInfo, FseRequestContext } from './claims.js';
import { FSE_ENVIRONMENTS, normalizeBaseUrl, type FseEnvironment } from './environments.js';
import { FseConfigError, FseGatewayError, FseTransportError } from './errors.js';
import {
  prepareValidationRequest,
  type PreparedFseRequest,
  type PrepareSettings,
  type ValidateInput,
} from './request.js';
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  interpretValidationResponse,
  readBoundedBody,
  type ValidationResult,
} from './response.js';
import type { FseJwtSigner } from './signer.js';
import { buildTlsConnectOptions, createMtlsAgent, type FseTlsOptions } from './tls.js';
import type {
  PublicationCreationReqDTO,
  PublicationResDTO,
  PublicationUpdateReqDTO,
  ResponseWifDTO,
  UpdateMetadataReqDTO,
} from './types.js';

/** Options of {@link FseGatewayClient}. */
export interface FseGatewayClientOptions {
  /** Known environment. Default `pre`. Ignored when `baseUrl` is set. */
  environment?: FseEnvironment;
  /** Custom HTTPS base URL including the version (e.g. a regional proxy). Also used as JWT `aud`. */
  baseUrl?: string;
  /** Authentication certificate for mTLS. */
  tls: FseTlsOptions;
  /** Signs the two JWTs with the signature certificate. */
  signer: FseJwtSigner;
  /** Accredited software identification (`subject_application_*`). */
  application: FseApplicationInfo;
  /** JWT lifetime in seconds, 1–300. Default 300. */
  tokenTtlSeconds?: number;
  /** Timeout for connect, response headers and body, each. Default 60 s. */
  timeoutMs?: number;
  /** Maximum response size. Default 1 MiB. */
  maxResponseBytes?: number;
  /** Maximum PDF size. Default 20 MiB. */
  maxPdfBytes?: number;
}

/** Input of {@link FseGatewayClient.publish}. */
export interface PublishInput {
  pdf: Uint8Array;
  requestBody: PublicationCreationReqDTO;
  context: FseRequestContext;
}

/** Input of {@link FseGatewayClient.replace}. */
export interface ReplaceInput {
  /** OID of the document to replace (`idDoc`). */
  documentId: string;
  pdf: Uint8Array;
  requestBody: PublicationUpdateReqDTO;
  context: FseRequestContext;
}

/** Input of {@link FseGatewayClient.delete}. */
export interface DeleteInput {
  documentId: string;
  context: FseRequestContext;
}

/** Input of {@link FseGatewayClient.updateMetadata}. */
export interface UpdateMetadataInput {
  documentId: string;
  requestBody: UpdateMetadataReqDTO;
  context: FseRequestContext;
}

/**
 * Client for the FSE 2.0 gateway (UNOFFICIAL, not affiliated with Ministero della Salute or Sogei).
 *
 * Every call uses mutual TLS with the authentication certificate (server verification always on) and two
 * fresh JWTs signed with the signature certificate. Errors never contain tokens, keys, fiscal codes or
 * document content.
 *
 * ```ts
 * const client = new FseGatewayClient({
 *   environment: 'pre',
 *   tls: { cert: readFileSync(authCertPath), key: readFileSync(authKeyPath) },
 *   signer: RsaPemJwtSigner.fromPem({ privateKeyPem, certificatePem }),
 *   application: { id: 'MYAPP', vendor: 'MY VENDOR', version: '1.0.0' },
 * });
 * const result = await client.validate({ pdf, requestBody: { activity: 'VERIFICA' }, context });
 * await client.close();
 * ```
 */
export class FseGatewayClient {
  readonly baseUrl: string;
  readonly #agent: Agent;
  readonly #settings: PrepareSettings;
  readonly #maxResponseBytes: number;
  readonly #timeoutMs: number;

  constructor(options: FseGatewayClientOptions) {
    const environment = options.environment ?? 'pre';
    const rawBaseUrl = options.baseUrl ?? FSE_ENVIRONMENTS[environment];
    if (rawBaseUrl === undefined) throw new FseConfigError(`Unknown FSE environment ${String(environment)}`);
    try {
      this.baseUrl = normalizeBaseUrl(rawBaseUrl);
    } catch (error) {
      throw new FseConfigError((error as Error).message);
    }
    this.#timeoutMs = positiveInt(options.timeoutMs ?? 60_000, 'timeoutMs');
    this.#maxResponseBytes = positiveInt(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    );
    this.#settings = {
      baseUrl: this.baseUrl,
      signer: options.signer,
      application: options.application,
      ...(options.tokenTtlSeconds === undefined ? {} : { tokenTtlSeconds: options.tokenTtlSeconds }),
      ...(options.maxPdfBytes === undefined
        ? {}
        : { maxPdfBytes: positiveInt(options.maxPdfBytes, 'maxPdfBytes') }),
    };
    this.#agent = createMtlsAgent(buildTlsConnectOptions(options.tls), {
      connectTimeoutMs: this.#timeoutMs,
      headersTimeoutMs: this.#timeoutMs,
      bodyTimeoutMs: this.#timeoutMs,
    });
  }

  /**
   * Builds the validation request (signed tokens, multipart parts) without sending it. Useful for dry runs:
   * print it with `summarizePreparedRequest`, never directly.
   */
  prepareValidation(input: ValidateInput): Promise<PreparedFseRequest> {
    return prepareValidationRequest(this.#settings, input);
  }

  /**
   * `POST /documents/validation`: syntactic, semantic and terminology validation of the CDA injected in the
   * PDF. With activity `VALIDATION` the returned `workflowInstanceId` links a later publication.
   *
   * @throws {FseValidationError} the document or request was rejected (400/413/415/422).
   * @throws {FseAuthError} credentials refused (401/403).
   * @throws {FseTransportError} network or TLS failure, timeout.
   * @throws {FseGatewayError} any other gateway error.
   */
  async validate(input: ValidateInput): Promise<ValidationResult> {
    const prepared = await this.prepareValidation(input);
    const { status, text } = await this.#sendMultipart(prepared);
    return interpretValidationResponse(status, text);
  }

  /** `POST /documents`: publication (creation). Not implemented yet. */
  async publish(_input: PublishInput): Promise<PublicationResDTO> {
    throw new NotImplementedError('FseGatewayClient.publish (POST /documents)');
  }

  /** `PUT /documents/{idDoc}`: replace a published document. Not implemented yet. */
  async replace(_input: ReplaceInput): Promise<PublicationResDTO> {
    throw new NotImplementedError('FseGatewayClient.replace (PUT /documents/{idDoc})');
  }

  /** `DELETE /documents/{idDoc}`. Not implemented yet. */
  async delete(_input: DeleteInput): Promise<ResponseWifDTO> {
    throw new NotImplementedError('FseGatewayClient.delete (DELETE /documents/{idDoc})');
  }

  /** `PUT /documents/{idDoc}/metadata`. Not implemented yet. */
  async updateMetadata(_input: UpdateMetadataInput): Promise<ResponseWifDTO> {
    throw new NotImplementedError('FseGatewayClient.updateMetadata (PUT /documents/{idDoc}/metadata)');
  }

  /** Closes the pooled TLS connections. */
  async close(): Promise<void> {
    await this.#agent.close();
  }

  async #sendMultipart(prepared: PreparedFseRequest): Promise<{ status: number; text: string }> {
    const form = new FormData();
    // Plain text part, as in the official curl example (README §3.1.1). The test-container .http files send
    // it with `Content-Type: application/json`. TODO(verify): whether the gateway requires that part type.
    form.append('requestBody', prepared.requestBodyJson);
    form.append(
      'file',
      new Blob([prepared.file.bytes], { type: prepared.file.contentType }),
      prepared.file.name,
    );

    let response;
    try {
      response = await this.#agent.request({
        origin: new URL(prepared.url).origin,
        path: new URL(prepared.url).pathname,
        method: prepared.method,
        headers: prepared.headers,
        body: form,
        headersTimeout: this.#timeoutMs,
        bodyTimeout: this.#timeoutMs,
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new FseTransportError(
        `Request to the FSE gateway failed${typeof code === 'string' ? ` (${code})` : ''}`,
        {
          operation: prepared.operation,
          cause: error,
        },
      );
    }

    let text: string;
    try {
      text = await readBoundedBody(response.body, this.#maxResponseBytes);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new FseGatewayError(error.message, {
          status: response.statusCode,
          operation: prepared.operation,
        });
      }
      throw new FseTransportError('Reading the FSE gateway response failed', {
        status: response.statusCode,
        operation: prepared.operation,
        cause: error,
      });
    }
    return { status: response.statusCode, text };
  }

  toJSON(): Record<string, unknown> {
    return { type: 'FseGatewayClient', baseUrl: this.baseUrl };
  }

  [inspect.custom](): string {
    return `FseGatewayClient { baseUrl: ${JSON.stringify(this.baseUrl)} }`;
  }
}

function positiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new FseConfigError(`${name} must be a positive integer`);
  return value;
}
