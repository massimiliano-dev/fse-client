import { inspect } from 'node:util';
import { FormData, type Agent } from 'undici';
import type { FseApplicationInfo } from './claims.js';
import { FSE_ENVIRONMENTS, normalizeBaseUrl, type FseEnvironment } from './environments.js';
import { FseConfigError, FseGatewayError, FseTransportError } from './errors.js';
import {
  prepareDeleteRequest,
  preparePublicationRequest,
  prepareReplaceRequest,
  prepareStatusRequest,
  prepareUpdateMetadataOscuramentoRequest,
  prepareUpdateMetadataRequest,
  prepareValidateAndCreateRequest,
  prepareValidateAndReplaceRequest,
  prepareValidationRequest,
  type DeleteInput,
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
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  interpretPublicationResponse,
  interpretStatusResponse,
  interpretValidationResponse,
  interpretWorkflowResponse,
  readBoundedBody,
  type PublicationResult,
  type TransactionStatusResult,
  type ValidationResult,
  type WorkflowResult,
} from './response.js';
import type { FseJwtSigner } from './signer.js';
import { waitForTransaction, type WaitForStatusOptions, type WaitForStatusResult } from './status.js';
import { buildTlsConnectOptions, createMtlsAgent, type FseTlsOptions } from './tls.js';

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
  /**
   * Maximum response size. Default 1 MiB. Raise it when using `includeFhirBundle`, or for status queries in
   * the validation environment, whose events can carry whole SOAP exchanges (guide §13).
   */
  maxResponseBytes?: number;
  /** Maximum PDF size. Default 20 MiB. */
  maxPdfBytes?: number;
}

/** Per-call options. */
export interface FseCallOptions {
  /** Aborts the request. */
  signal?: AbortSignal;
}

/**
 * Client for the FSE 2.0 gateway (UNOFFICIAL, not affiliated with Ministero della Salute or Sogei).
 *
 * Every call uses mutual TLS with the authentication certificate (server verification always on) and
 * fresh JWTs signed with the signature certificate. Request bodies and path parameters are checked against
 * the official OpenAPI before anything is signed. Errors never contain tokens, keys, fiscal codes or
 * document content.
 *
 * Typical flow (guide §2): `validate` (activity `VALIDATION`) → sign the PDF in PAdES → `publish` with the
 * returned `workflowInstanceId` → `waitForStatus`.
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

  /** Builds `POST /documents` without sending it (dry runs). */
  preparePublish(input: PublishInput): Promise<PreparedFseRequest> {
    return preparePublicationRequest(this.#settings, input);
  }

  /** Builds `POST /documents/validate-and-create` without sending it (dry runs). */
  prepareValidateAndCreate(input: ValidateAndCreateInput): Promise<PreparedFseRequest> {
    return prepareValidateAndCreateRequest(this.#settings, input);
  }

  /** Builds `PUT /documents/{idDoc}` without sending it (dry runs). */
  prepareReplace(input: ReplaceInput): Promise<PreparedFseRequest> {
    return prepareReplaceRequest(this.#settings, input);
  }

  /** Builds `PUT /documents/validate-and-replace/{idDoc}` without sending it (dry runs). */
  prepareValidateAndReplace(input: ValidateAndReplaceInput): Promise<PreparedFseRequest> {
    return prepareValidateAndReplaceRequest(this.#settings, input);
  }

  /** Builds `DELETE /documents/{idDoc}` without sending it (dry runs). */
  prepareDelete(input: DeleteInput): Promise<PreparedFseRequest> {
    return prepareDeleteRequest(this.#settings, input);
  }

  /** Builds `PUT /documents/{idDoc}/metadata` (or `/metadata-iti-57`) without sending it (dry runs). */
  prepareUpdateMetadata(
    input: UpdateMetadataInput,
    variant: 'metadata' | 'metadata-iti-57' = 'metadata',
  ): Promise<PreparedFseRequest> {
    return prepareUpdateMetadataRequest(this.#settings, input, variant);
  }

  /** Builds `PUT /documents/{idDoc}/metadata-oscuramento-catena` without sending it (dry runs). */
  prepareUpdateMetadataOscuramentoCatena(input: UpdateMetadataOscuramentoInput): Promise<PreparedFseRequest> {
    return prepareUpdateMetadataOscuramentoRequest(this.#settings, input);
  }

  /** Builds a status request (`/status/{workflowInstanceId}` or `/status/search/{traceId}`) without sending it. */
  prepareStatus(
    input: StatusQueryInput & ({ workflowInstanceId: string } | { traceId: string }),
  ): Promise<PreparedFseRequest> {
    return prepareStatusRequest(this.#settings, input);
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
  async validate(input: ValidateInput, options: FseCallOptions = {}): Promise<ValidationResult> {
    const prepared = await this.prepareValidation(input);
    const { status, text } = await this.#send(prepared, options);
    return interpretValidationResponse(status, text);
  }

  /**
   * `POST /documents` (guide §5): publication of a PAdES-signed PDF whose CDA was validated before with
   * activity `VALIDATION` (pass its `workflowInstanceId`). The gateway converts the CDA to FHIR synchronously
   * and then sends it to INI/EDS asynchronously: a 202 means "taken in charge"; follow the outcome with
   * {@link waitForStatus}. Never retry blindly on a timeout: check the status first.
   *
   * @throws {FseValidationError} invalid request or the CDA was not validated before (400, `/msg/cda-match`).
   * @throws {FseAuthError} credentials refused (401/403).
   * @throws {FseTransportError} network or TLS failure, timeout.
   * @throws {FseGatewayError} any other gateway error (409, 429, 5xx…).
   */
  async publish(input: PublishInput, options: FseCallOptions = {}): Promise<PublicationResult> {
    const prepared = await this.preparePublish(input);
    const { status, text } = await this.#send(prepared, options);
    return interpretPublicationResponse(status, text, prepared.operation, fhir(input));
  }

  /**
   * `POST /documents/validate-and-create` (guide §10): validation and publication in one call. The guide
   * reserves it for recovering from errors of the normal flow ("non è da intendersi per un utilizzo
   * regolare"), e.g. when the validation could not be done when the document was issued.
   */
  async validateAndCreate(
    input: ValidateAndCreateInput,
    options: FseCallOptions = {},
  ): Promise<PublicationResult> {
    const prepared = await this.prepareValidateAndCreate(input);
    const { status, text } = await this.#send(prepared, options);
    return interpretPublicationResponse(status, text, prepared.operation, fhir(input));
  }

  /** `PUT /documents/{idDoc}` (guide §7): replaces a published document. 202 = taken in charge. */
  async replace(input: ReplaceInput, options: FseCallOptions = {}): Promise<PublicationResult> {
    const prepared = await this.prepareReplace(input);
    const { status, text } = await this.#send(prepared, options);
    return interpretPublicationResponse(status, text, prepared.operation, fhir(input));
  }

  /**
   * `PUT /documents/validate-and-replace/{idDoc}` (guide §11): validation and replacement in one call; like
   * {@link validateAndCreate}, only for recovering from errors of the normal flow. 404 if the document to
   * replace is not on INI.
   */
  async validateAndReplace(
    input: ValidateAndReplaceInput,
    options: FseCallOptions = {},
  ): Promise<PublicationResult> {
    const prepared = await this.prepareValidateAndReplace(input);
    const { status, text } = await this.#send(prepared, options);
    return interpretPublicationResponse(status, text, prepared.operation, fhir(input));
  }

  /**
   * `DELETE /documents/{idDoc}` (guide §6): deletes the FHIR resources and the INI metadata. 200 = deleted,
   * 202 = taken in charge after an error.
   */
  async delete(input: DeleteInput, options: FseCallOptions = {}): Promise<WorkflowResult> {
    const prepared = await this.prepareDelete(input);
    const { status, text } = await this.#send(prepared, options);
    return interpretWorkflowResponse(status, text, prepared.operation, [200, 202]);
  }

  /**
   * `PUT /documents/{idDoc}/metadata` (guide §8). 200 = updated (OpenAPI); the guide also lists 202 (taken
   * in charge after an error, Tabella 32).
   */
  async updateMetadata(input: UpdateMetadataInput, options: FseCallOptions = {}): Promise<WorkflowResult> {
    const prepared = await this.prepareUpdateMetadata(input, 'metadata');
    const { status, text } = await this.#send(prepared, options);
    return interpretWorkflowResponse(status, text, prepared.operation, [200, 202]);
  }

  /**
   * `PUT /documents/{idDoc}/metadata-iti-57` (guide §8): same contract as {@link updateMetadata}, exposed "in
   * ambiente di validazione" for the transition to IHE ITI-57; it will later be served by `/metadata`.
   */
  async updateMetadataIti57(
    input: UpdateMetadataInput,
    options: FseCallOptions = {},
  ): Promise<WorkflowResult> {
    const prepared = await this.prepareUpdateMetadata(input, 'metadata-iti-57');
    const { status, text } = await this.#send(prepared, options);
    return interpretWorkflowResponse(status, text, prepared.operation, [200, 202]);
  }

  /**
   * `PUT /documents/{idDoc}/metadata-oscuramento-catena` (guide §9): metadata update for a blacking-out chain
   * (`P99`). Reserved to regional nodes: `subject_role` NOR, `purpose_of_use` SYSADMIN. Not available in
   * production (guide §2, Tabella 4). The gateway signals success with the INI warning
   * "R220 - The requestor is RDA for the patient" in `warning`. TODO(verify): the text of guide §9 has the
   * "R220 - " prefix, the example of §9.2.1 does not; this client returns the warning as received.
   */
  async updateMetadataOscuramentoCatena(
    input: UpdateMetadataOscuramentoInput,
    options: FseCallOptions = {},
  ): Promise<WorkflowResult> {
    const prepared = await this.prepareUpdateMetadataOscuramentoCatena(input);
    const { status, text } = await this.#send(prepared, options);
    return interpretWorkflowResponse(status, text, prepared.operation, [200]);
  }

  /**
   * `GET /status/{workflowInstanceId}` (guide §13): all events of a transaction. Only the Bearer token is
   * sent. Event texts are redacted (fiscal codes; SOAP payloads shown in the validation environment).
   *
   * `subject` becomes the Bearer `sub`: guide Tabella 54 says it is the operator fiscal code (IHE CX).
   * TODO(verify): the dispatcher code run by it-fse-gtw-test-container (`TransactionInspectCTL.getEvents`)
   * authorises this call by comparing the 3 characters after `#` in `sub` with those of the events' issuer
   * (`integrity:<signature certificate CN>`, e.g. `S1#110201234567XX`), and answers 401 when `sub` has no `#`;
   * `GET /status/search/{traceId}` has no such check there.
   *
   * @throws {FseNotFoundError} unknown transaction (404).
   */
  async getStatus(
    workflowInstanceId: string,
    query: StatusQueryInput & FseCallOptions,
  ): Promise<TransactionStatusResult> {
    // Guide §13: "Tale funzionalità sarà presente solo ed esclusivamente in ambiente di validazione."
    if (this.baseUrl === normalizeBaseUrl(FSE_ENVIRONMENTS.prod)) {
      throw new FseConfigError(
        'Status by workflowInstanceId exists only in the validation (PRE) environment (guide §13); in production use getStatusByTraceId',
      );
    }
    const prepared = await this.prepareStatus({ workflowInstanceId, subject: query.subject });
    const { status, text } = await this.#send(prepared, query);
    return interpretStatusResponse(status, text, prepared.operation);
  }

  /** `GET /status/search/{traceId}` (guide §14): all events of a transaction, by trace id. */
  async getStatusByTraceId(
    traceId: string,
    query: StatusQueryInput & FseCallOptions,
  ): Promise<TransactionStatusResult> {
    const prepared = await this.prepareStatus({ traceId, subject: query.subject });
    const { status, text } = await this.#send(prepared, query);
    return interpretStatusResponse(status, text, prepared.operation);
  }

  /**
   * Polls {@link getStatus} with bounded exponential backoff (default 10 attempts, 2 s doubling up to 30 s)
   * until the transaction succeeds or fails, the attempts run out (`outcome: 'pending'`) or `signal`
   * aborts. Never polls forever.
   */
  waitForStatus(workflowInstanceId: string, options: WaitForStatusOptions): Promise<WaitForStatusResult> {
    return waitForTransaction(
      (signal) =>
        this.getStatus(workflowInstanceId, { subject: options.subject, ...(signal ? { signal } : {}) }),
      options,
    );
  }

  /** Closes the pooled TLS connections. */
  async close(): Promise<void> {
    await this.#agent.close();
  }

  async #send(
    prepared: PreparedFseRequest,
    options: FseCallOptions,
  ): Promise<{ status: number; text: string }> {
    const url = new URL(prepared.url);
    if (url.origin !== new URL(this.baseUrl).origin) {
      throw new FseConfigError('The prepared request targets another origin than this client');
    }
    let body: FormData | string | undefined;
    if (prepared.body.kind === 'multipart') {
      const form = new FormData();
      // Plain text part, as in the official curl examples (guide §3.1.1). The test-container .http files
      // send it with `Content-Type: application/json`. TODO(verify): whether the gateway requires that type.
      form.append('requestBody', prepared.body.requestBodyJson);
      form.append(
        'file',
        new Blob([prepared.body.file.bytes], { type: prepared.body.file.contentType }),
        prepared.body.file.name,
      );
      body = form;
    } else if (prepared.body.kind === 'json') {
      body = prepared.body.json;
    }

    let response;
    try {
      response = await this.#agent.request({
        origin: url.origin,
        path: url.pathname,
        method: prepared.method,
        headers: prepared.headers,
        ...(body === undefined ? {} : { body }),
        headersTimeout: this.#timeoutMs,
        bodyTimeout: this.#timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
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
      if (options.signal?.aborted) throw options.signal.reason;
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

function fhir(input: { includeFhirBundle?: boolean }): { includeFhirBundle?: boolean } {
  return input.includeFhirBundle ? { includeFhirBundle: true } : {};
}

function positiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new FseConfigError(`${name} must be a positive integer`);
  return value;
}
