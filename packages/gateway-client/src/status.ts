import { setTimeout as delay } from 'node:timers/promises';
import { FseConfigError, FseGatewayError, FseNotFoundError } from './errors.js';
import type { TransactionStatusResult } from './response.js';
import type { StatusCheckDTO } from './types.js';

/**
 * Event types treated as the end of a transaction by {@link waitForTransaction} when they report `SUCCESS`.
 * Sources: guide §12.6 "Stati transazione" (`SEND_TO_INI`, `UAR_FINAL_STATUS`) and the examples of §13.2.1
 * (creation ends with `SEND_TO_INI`), §13.2.2 (delete ends with `INI_DELETE`), §13.2.3 (replace ends with
 * `SEND_TO_INI`), §13.2.4 (update ends with `INI_UPDATE`).
 * TODO(verify): for documents also sent to the regional archive (UAR/EDS) the guide does not say whether
 * `SEND_TO_INI` precedes `UAR_FINAL_STATUS`; pass `isFinal` to wait for a specific event.
 */
export const DEFAULT_FINAL_EVENT_TYPES = [
  'SEND_TO_INI',
  'INI_DELETE',
  'INI_UPDATE',
  'UAR_FINAL_STATUS',
] as const;

/** Outcome of {@link waitForTransaction}. */
export interface WaitForStatusResult {
  /**
   * `success`: a final event reported SUCCESS; `failure`: an event reported BLOCKING_ERROR (guide §12.6);
   * `pending`: the attempts ran out before either happened (the transaction may still complete).
   */
  outcome: 'success' | 'failure' | 'pending';
  /** Number of status requests made. */
  attempts: number;
  /** Last status received, if any. */
  status: TransactionStatusResult | undefined;
}

/** Options of `FseGatewayClient.waitForStatus`. All limits are bounded: polling can never be infinite. */
export interface WaitForStatusOptions {
  /** `sub` of the Bearer token (operator, IHE CX). */
  subject: string;
  /** Maximum number of status requests, 1–100. Default 10. */
  maxAttempts?: number;
  /** Delay before the second request, in ms, 0–300000. Default 2000. */
  initialDelayMs?: number;
  /** Upper bound of the delay between requests, in ms, 0–300000. Default 30000. */
  maxDelayMs?: number;
  /** Multiplier of the delay after each attempt, 1–10. Default 2. */
  backoffFactor?: number;
  /** Treat HTTP 404 (`/msg/record-not-found`) as "not recorded yet" and keep polling. Default true. */
  retryOnNotFound?: boolean;
  /** Decides when the transaction is over. Default: see {@link defaultTransactionOutcome}. */
  isFinal?: (events: readonly StatusCheckDTO[]) => 'success' | 'failure' | undefined;
  /** Aborts the wait (and the in-flight request). */
  signal?: AbortSignal;
}

/**
 * Default end-of-transaction rule: any `BLOCKING_ERROR` is a failure; a `SUCCESS` of one of
 * {@link DEFAULT_FINAL_EVENT_TYPES} is a success.
 */
export function defaultTransactionOutcome(
  events: readonly StatusCheckDTO[],
): 'success' | 'failure' | undefined {
  if (events.some((e) => e.eventStatus === 'BLOCKING_ERROR')) return 'failure';
  const finals: readonly string[] = DEFAULT_FINAL_EVENT_TYPES;
  if (events.some((e) => e.eventStatus === 'SUCCESS' && finals.includes(e.eventType ?? ''))) return 'success';
  return undefined;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number, name: string) {
  const v = value ?? fallback;
  if (!Number.isFinite(v) || v < min || v > max) {
    throw new FseConfigError(`${name} must be between ${min} and ${max}`);
  }
  return v;
}

/**
 * Polls a status function with exponential backoff until the transaction ends, the attempts run out or the
 * signal aborts. Transient errors (404 when `retryOnNotFound`, 429, 502, 503, 504) consume an attempt and
 * are retried; any other error is thrown.
 */
export async function waitForTransaction(
  fetchStatus: (signal: AbortSignal | undefined) => Promise<TransactionStatusResult>,
  options: WaitForStatusOptions,
): Promise<WaitForStatusResult> {
  const maxAttempts = bounded(options.maxAttempts, 10, 1, 100, 'maxAttempts');
  if (!Number.isInteger(maxAttempts)) throw new FseConfigError('maxAttempts must be an integer');
  let wait = bounded(options.initialDelayMs, 2000, 0, 300_000, 'initialDelayMs');
  const maxDelay = bounded(options.maxDelayMs, 30_000, 0, 300_000, 'maxDelayMs');
  const factor = bounded(options.backoffFactor, 2, 1, 10, 'backoffFactor');
  const isFinal = options.isFinal ?? defaultTransactionOutcome;
  const retryOnNotFound = options.retryOnNotFound ?? true;
  const { signal } = options;

  let status: TransactionStatusResult | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    try {
      status = await fetchStatus(signal);
      const outcome = isFinal(status.transactionData);
      if (outcome) return { outcome, attempts: attempt, status };
    } catch (error) {
      const transient =
        error instanceof FseGatewayError &&
        (error.retryable || (retryOnNotFound && error instanceof FseNotFoundError));
      if (!transient) throw error;
      lastError = error;
    }
    if (attempt < maxAttempts) {
      try {
        await delay(Math.min(wait, maxDelay), undefined, signal ? { signal } : undefined);
      } catch (error) {
        // timers/promises rejects with a generic AbortError: surface the caller's abort reason instead.
        if (signal?.aborted) throw signal.reason;
        throw error;
      }
      wait = Math.min(wait * factor, maxDelay);
    }
  }
  // Never got a single answer: surface the last transient error instead of a silent "pending".
  if (status === undefined && lastError !== undefined) throw lastError;
  return { outcome: 'pending', attempts: maxAttempts, status };
}
