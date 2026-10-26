import { FseError } from '@massimiliano-dev/fse-core';
import type { FseProblemDetails } from './types.js';

/** Invalid client configuration (bad certificate, key mismatch, expiry too long, non-HTTPS URL…). */
export class FseConfigError extends FseError {}

/** Context of a failed gateway call. Contains only correlation ids, never tokens or document data. */
export interface FseGatewayErrorInit {
  /** HTTP status, if a response was received. */
  status?: number;
  /** Gateway operation, e.g. `validate`. */
  operation: string;
  /** RFC 7807 problem returned by the gateway, with free-text fields already redacted. */
  problem?: FseProblemDetails;
  cause?: unknown;
}

/**
 * Base class of errors raised while talking to the gateway. `message`, `problem.detail` and
 * `problem.title` are redacted; `traceID`/`spanID`/`workflowInstanceId` are kept to correlate with the
 * gateway's transaction status services.
 */
export class FseGatewayError extends FseError {
  readonly status: number | undefined;
  readonly operation: string;
  readonly problem: FseProblemDetails | undefined;

  constructor(message: string, init: FseGatewayErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.operation = init.operation;
    this.problem = init.problem;
  }

  /** Gateway trace id, useful for support requests and `/status/search/{traceId}`. */
  get traceId(): string | undefined {
    return this.problem?.traceID;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), status: this.status, operation: this.operation, problem: this.problem };
  }
}

/** One problem reported by the gateway for a rejected document. */
export interface FseValidationIssue {
  /** Problem type URI, e.g. `/msg/syntax`, `/msg/semantic`, `/msg/vocabulary`, `/msg/cda-element`. */
  type: string | undefined;
  title: string | undefined;
  /** Redacted detail. */
  detail: string | undefined;
  instance: string | undefined;
}

/**
 * The gateway rejected the document or the request (HTTP 400, 413, 415, 422).
 *
 * The gateway returns one RFC 7807 problem per response (README §15), so `errors` currently has one item.
 * It is a list so that callers do not change when the gateway reports several schematron failures.
 * TODO(verify): whether `detail` aggregates several failed schematron asserts in one string.
 */
export class FseValidationError extends FseGatewayError {
  readonly errors: readonly FseValidationIssue[];

  constructor(message: string, init: FseGatewayErrorInit) {
    super(message, init);
    const p = init.problem;
    this.errors = p ? [{ type: p.type, title: p.title, detail: p.detail, instance: p.instance }] : [];
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), errors: this.errors };
  }
}

/** Authentication or authorisation failed (HTTP 401/403): bad or expired JWT, certificate not enabled. */
export class FseAuthError extends FseGatewayError {}

/** No usable HTTP response: DNS, TCP, TLS handshake (including certificate verification), timeouts. */
export class FseTransportError extends FseGatewayError {}
